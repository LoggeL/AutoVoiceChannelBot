import { Events, OverwriteType } from 'discord.js';
import { CHANNEL_TYPES, PERMISSIONS, HIGH_BITRATE } from './constants.js';
import { fetchChannel, deleteChannel } from './channels.js';
import { createQueue } from './queue.js';
import * as db from './db.js';
import log from './logger.js';

const ownerPermissions = PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.MANAGE_ROLES;

function ownerOverwrites(channel, ownerId, previousOwnerId) {
  const overwrites = new Map(channel.permissionOverwrites.cache.map(overwrite => [overwrite.id, {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  }]));
  const previous = overwrites.get(previousOwnerId);
  if (previous) {
    previous.allow &= ~ownerPermissions;
    previous.deny &= ~ownerPermissions;
    if (!previous.allow && !previous.deny) overwrites.delete(previousOwnerId);
  }
  const owner = overwrites.get(ownerId) ?? { id: ownerId, type: OverwriteType.Member, allow: 0n, deny: 0n };
  owner.allow |= ownerPermissions;
  owner.deny &= ~ownerPermissions;
  overwrites.set(ownerId, owner);
  return [...overwrites.values()];
}

export function setup(client, config, textIDs, createTextChannel, { database = db, ready = Promise.resolve() } = {}) {
  const enqueue = createQueue();
  const pendingCreations = new Set();
  const highBitrateGuilds = new Set(config.highBitrateGuilds);

  async function pairedTextChannel(guild, voiceId) {
    const textId = textIDs.get(voiceId);
    return textId ? fetchChannel(guild.channels, textId) : null;
  }

  async function removeEmptyChannel(channel) {
    if (channel.members.size > 0) return;
    await deleteChannel(channel);
    const text = await pairedTextChannel(channel.guild, channel.id);
    if (text) await deleteChannel(text);
    if (textIDs.has(channel.id)) {
      await database.deleteTextID(channel.id);
      textIDs.delete(channel.id);
    }
    log.info('voice', 'Deleted empty channel and its text pair', { channel: channel.id });
  }

  async function createChannels(member, guild, trigger, category) {
    // Queued events may be stale if the member has already left the trigger.
    if (member.user.bot || member.voice.channelId !== trigger.id) return;
    let voice;
    let text;
    try {
      voice = await guild.channels.create({
        name: member.user.username.toLowerCase(),
        type: CHANNEL_TYPES.VOICE,
        parent: category.id,
        permissionOverwrites: ownerOverwrites(category, member.id),
        ...(highBitrateGuilds.has(guild.id) && { bitrate: Math.min(HIGH_BITRATE, guild.maximumBitrate) }),
      });

      if (member.voice.channelId !== trigger.id) {
        await removeEmptyChannel(voice);
        return;
      }

      if (createTextChannel.get(guild.id)) {
        text = await guild.channels.create({
          name: member.user.username.toLowerCase(),
          type: CHANNEL_TYPES.TEXT,
          parent: category.id,
          permissionOverwrites: [
            { id: member.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.MANAGE_ROLES] },
            { id: guild.id, deny: [PERMISSIONS.VIEW_CHANNEL] },
            { id: client.user.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.MANAGE_ROLES] },
          ],
        });
        // Track the pair before moving the member so the resulting voice event
        // cannot run before its text channel exists.
        textIDs.set(voice.id, text.id);
        await database.insertTextID(voice.id, text.id);
      }

      if (member.voice.channelId !== trigger.id) {
        await removeEmptyChannel(voice);
        return;
      }
      await member.voice.setChannel(voice);
      log.info('voice', 'Created temporary channels', { guild: guild.id, voice: voice.id, text: text?.id, user: member.id });
    } catch (err) {
      if (voice && voice.members.size === 0) {
        try {
          await removeEmptyChannel(voice);
        } catch (cleanupError) {
          log.error('voice', 'Failed to roll back channel creation', { error: cleanupError.message, channel: voice.id });
        }
      }
      throw err;
    }
  }

  async function handleDeparture(channel, member) {
    if (channel.members.has(member.id)) return;
    if (channel.members.size === 0) {
      await removeEmptyChannel(channel);
      return;
    }

    const text = await pairedTextChannel(channel.guild, channel.id);
    if (text && text.permissionOverwrites.cache.has(member.id) && member.id !== client.user.id) {
      await text.permissionOverwrites.delete(member.id);
    }

    const overwrite = channel.permissionOverwrites.cache.get(member.id);
    if (overwrite?.type !== OverwriteType.Member || !overwrite.allow.has(ownerPermissions)) return;
    const newOwner = channel.members.find(candidate => !candidate.user.bot) ?? channel.members.first();
    if (!newOwner) return;

    await channel.edit({
      name: newOwner.user.username.toLowerCase(),
      permissionOverwrites: ownerOverwrites(channel, newOwner.id, member.id),
    });
    if (text) {
      await text.permissionOverwrites.edit(newOwner.id, {
        ViewChannel: true, ManageChannels: true, ManageRoles: true,
      });
    }
    log.info('voice', 'Transferred channel ownership', { channel: channel.id, newOwner: newOwner.id });
  }

  const handleVoiceState = (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return Promise.resolve();
    // Capture channel references now: queued events can outlive cache entries.
    const previous = oldState.channel;
    const next = newState.channel;
    const member = newState.member ?? oldState.member;
    const guild = newState.guild;
    if (!member) return Promise.resolve();

    // Discord can acknowledge a move before its gateway cache catches up.
    // Deduplicate at event arrival, before either request enters the queue.
    const creationKey = next?.type === CHANNEL_TYPES.VOICE && next.name === config.channelName &&
      guild.channels.cache.get(next.parentId)?.name === config.categoryName
      ? `${guild.id}:${member.id}` : null;
    const duplicateCreation = creationKey !== null && pendingCreations.has(creationKey);
    if (creationKey && !duplicateCreation) pendingCreations.add(creationKey);

    return enqueue(guild.id, async () => {
      await ready;
      const category = guild.channels.cache.find(channel =>
        channel.name === config.categoryName && channel.type === CHANNEL_TYPES.CATEGORY);
      if (!category) return;
      const trigger = guild.channels.cache.find(channel =>
        channel.parentId === category.id && channel.name === config.channelName && channel.type === CHANNEL_TYPES.VOICE);
      const isManaged = channel => channel?.type === CHANNEL_TYPES.VOICE &&
        channel.parentId === category.id && channel.id !== trigger?.id;

      if (isManaged(previous) && guild.channels.cache.has(previous.id)) {
        try {
          await handleDeparture(previous, member);
        } catch (err) {
          log.error('voice', 'Failed to handle channel departure', { error: err.message, channel: previous.id });
        }
      }

      if (trigger && next?.id === trigger.id) {
        if (!duplicateCreation) await createChannels(member, guild, trigger, category);
      } else if (isManaged(next) && next.members.has(member.id)) {
        const text = await pairedTextChannel(guild, next.id);
        if (text && !text.permissionOverwrites.cache.get(member.id)?.allow.has(PERMISSIONS.VIEW_CHANNEL)) {
          await text.permissionOverwrites.edit(member.id, { ViewChannel: true });
        }
      }
    }).catch(err => {
      log.error('voice', 'Failed to handle voice state', { error: err.message, guild: guild.id, user: member.id });
    }).finally(() => {
      if (creationKey && !duplicateCreation) pendingCreations.delete(creationKey);
    });
  };

  client.on(Events.VoiceStateUpdate, handleVoiceState);
  return handleVoiceState;
}
