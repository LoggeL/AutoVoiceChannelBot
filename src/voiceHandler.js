const { CHANNEL_TYPES, PERMISSIONS, HIGH_BITRATE } = require('./constants');
const db = require('./db');
const log = require('./logger');

// In-flight operations to prevent race conditions
const pendingOps = new Set();

function setup(client, config, textIDs, createTextChannel) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;

    const member = newState.member;
    const guild = newState.guild;

    const addCategory = guild.channels.cache.find(
      (ch) => ch.name === config.categoryName && ch.type === CHANNEL_TYPES.CATEGORY
    );
    const addChannel = guild.channels.cache.find(
      (ch) => ch.name === config.channelName && ch.type === CHANNEL_TYPES.VOICE
    );

    if (!addChannel || !addCategory) {
      log.warn('voice', 'Missing creation channel or category', { guild: guild.id });
      return;
    }

    // Create new channel when user joins the creation channel
    if (newState.channel === addChannel) {
      await handleChannelCreate(member, guild, addChannel, addCategory, config, textIDs, createTextChannel, newState, client);
    }

    // User leaves a managed channel — update text channel permissions
    if (
      createTextChannel.get(guild.id) &&
      oldState.channel &&
      oldState.channel !== addChannel &&
      oldState.channel.parentId === addCategory.id &&
      oldState.channel.members.size > 0
    ) {
      await handleLeavePermissions(oldState, member, textIDs);
    }

    // User joins a managed channel — grant text channel access
    if (
      createTextChannel.get(guild.id) &&
      newState.channel &&
      newState.channel !== addChannel &&
      newState.channel.parentId === addCategory.id
    ) {
      await handleJoinPermissions(newState, member, textIDs);
    }

    // Don't delete the creation channel
    if (!oldState.channel || oldState.channel === addChannel) return;

    // Remove empty channels
    if (
      oldState.channel.parent === addCategory &&
      oldState.channel.members.size === 0
    ) {
      await handleEmptyChannel(oldState, textIDs, createTextChannel);
    }

    // Transfer ownership when original owner leaves
    if (
      oldState.channel.parent === addCategory &&
      oldState.channel.members.size > 0 &&
      oldState.channel.name === member.user.username
    ) {
      await handleOwnershipTransfer(oldState, member, textIDs, createTextChannel, client);
    }
  });
}

async function handleChannelCreate(member, guild, addChannel, addCategory, config, textIDs, createTextChannel, newState, client) {
  const opKey = `create-${member.id}-${guild.id}`;
  if (pendingOps.has(opKey)) return;
  pendingOps.add(opKey);

  try {
    const voiceChannel = await guild.channels.create({
      name: member.user.username.toLowerCase(),
      type: CHANNEL_TYPES.VOICE,
      parent: addCategory.id,
      permissionOverwrites: [
        { id: member.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.MANAGE_ROLES] },
      ],
    });

    if (config.highBitrateGuilds.includes(guild.id)) {
      await voiceChannel.setBitrate(HIGH_BITRATE);
    }

    await newState.setChannel(voiceChannel);
    log.info('voice', 'Created voice channel', { guild: guild.id, channel: voiceChannel.id, user: member.user.tag });

    if (!createTextChannel.get(guild.id)) return;

    const textChannel = await guild.channels.create({
      name: member.user.username.toLowerCase(),
      type: CHANNEL_TYPES.TEXT,
      parent: addCategory.id,
      permissionOverwrites: [
        { id: member.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.MANAGE_ROLES] },
        { id: guild.id, deny: [PERMISSIONS.VIEW_CHANNEL] },
        { id: client.user.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.MANAGE_ROLES] },
      ],
    });

    textIDs.set(voiceChannel.id, textChannel.id);
    await db.insertTextID(voiceChannel.id, textChannel.id);
    log.info('voice', 'Created text channel', { voice: voiceChannel.id, text: textChannel.id });
  } catch (err) {
    log.error('voice', 'Failed to create channel', { error: err.message, user: member.user.tag });
  } finally {
    pendingOps.delete(opKey);
  }
}

async function handleLeavePermissions(oldState, member, textIDs) {
  const txtID = textIDs.get(oldState.channel.id);
  if (!txtID) return;
  const txtChannel = oldState.guild.channels.cache.get(txtID);
  if (!txtChannel) return;

  try {
    await txtChannel.permissionOverwrites.delete(member.id);
  } catch (err) {
    log.error('voice', 'Failed to remove permission overwrite', { error: err.message });
  }
}

async function handleJoinPermissions(newState, member, textIDs) {
  const txtID = textIDs.get(newState.channel.id);
  if (!txtID) return;
  const txtChannel = newState.guild.channels.cache.get(txtID);
  if (!txtChannel) return;

  try {
    await txtChannel.permissionOverwrites.edit(member.id, { ViewChannel: true });
  } catch (err) {
    log.error('voice', 'Failed to add permission overwrite', { error: err.message });
  }
}

async function handleEmptyChannel(oldState, textIDs, createTextChannel) {
  const opKey = `delete-${oldState.channel.id}`;
  if (pendingOps.has(opKey)) return;
  pendingOps.add(opKey);

  const oldId = oldState.channel.id;

  try {
    await oldState.channel.delete();
    log.info('voice', 'Deleted empty voice channel', { channel: oldId });

    if (!createTextChannel.get(oldState.guild.id)) return;

    const textChannelId = textIDs.get(oldId);
    if (!textChannelId) return;

    const textChannel = oldState.guild.channels.cache.get(textChannelId);
    if (textChannel) {
      await textChannel.delete();
      log.info('voice', 'Deleted associated text channel', { channel: textChannelId });
    }

    textIDs.delete(oldId);
    await db.deleteTextID(oldId);
  } catch (err) {
    log.error('voice', 'Failed to delete empty channel', { error: err.message, channel: oldId });
  } finally {
    pendingOps.delete(opKey);
  }
}

async function handleOwnershipTransfer(oldState, member, textIDs, createTextChannel, client) {
  try {
    const newOwner = oldState.channel.members.random();
    await oldState.channel.edit({
      name: newOwner.user.username,
      permissionOverwrites: [
        { id: newOwner.id, allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.MANAGE_ROLES] },
      ],
    });
    log.info('voice', 'Transferred channel ownership', { channel: oldState.channel.id, newOwner: newOwner.user.tag });

    if (!createTextChannel.get(oldState.guild.id)) return;

    const txtID = textIDs.get(oldState.channel.id);
    if (!txtID) return;
    const txtChannel = oldState.guild.channels.cache.get(txtID);
    if (!txtChannel) return;

    await txtChannel.permissionOverwrites.delete(member.id).catch(() => {});
    await txtChannel.permissionOverwrites.edit(newOwner.id, {
      ViewChannel: true, ManageChannels: true, ManageRoles: true,
    });
    await txtChannel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true, ManageChannels: true, ManageRoles: true,
    });
  } catch (err) {
    log.error('voice', 'Failed to transfer ownership', { error: err.message });
  }
}

module.exports = { setup };
