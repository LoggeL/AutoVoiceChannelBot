import { EventEmitter } from 'node:events';
import { Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { CHANNEL_TYPES } from '../../src/constants.js';

export function fixture() {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const calls = { created: [], deleted: [], moved: [], edits: [], writes: [], removed: [] };
  const guild = { id: 'guild', client, maximumBitrate: 96_000 };
  guild.channels = {
    cache: new Collection(),
    async fetch(id) { return this.cache.get(id) ?? null; },
    async create(options) {
      calls.created.push(options);
      return channel(`created-${calls.created.length}`, options);
    },
  };
  client.guilds = { cache: new Collection([[guild.id, guild]]) };
  client.channels = guild.channels;

  function overwrite(raw) {
    return {
      id: raw.id,
      type: raw.type ?? (['guild', 'role'].includes(raw.id) ? OverwriteType.Role : OverwriteType.Member),
      allow: new PermissionsBitField(raw.allow ?? 0n),
      deny: new PermissionsBitField(raw.deny ?? 0n),
    };
  }

  function channel(id, options = {}) {
    const result = {
      id, guild, name: options.name ?? id, type: options.type ?? CHANNEL_TYPES.VOICE,
      parentId: options.parent ?? 'category', members: new Collection(),
      permissionOverwrites: {
        cache: new Collection((options.permissionOverwrites ?? []).map(raw => [raw.id, overwrite(raw)])),
        async edit(userId, permissions) {
          const value = this.cache.get(userId) ?? overwrite({ id: userId });
          for (const [name, enabled] of Object.entries(permissions)) {
            const bit = PermissionFlagsBits[name];
            assertPermission(bit, name);
            value.allow.remove(bit);
            value.deny.remove(bit);
            if (enabled === true) value.allow.add(bit);
            else if (enabled === false) value.deny.add(bit);
          }
          this.cache.set(userId, value);
          calls.edits.push({ channel: id, userId, permissions });
        },
        async delete(userId) { this.cache.delete(userId); },
      },
      async delete() { calls.deleted.push(id); guild.channels.cache.delete(id); },
      async edit(value) {
        if (value.name) this.name = value.name;
        if (value.permissionOverwrites) {
          this.permissionOverwrites.cache = new Collection(value.permissionOverwrites.map(raw => [raw.id, overwrite(raw)]));
        }
        calls.edits.push({ channel: id, ...value });
        return this;
      },
    };
    guild.channels.cache.set(id, result);
    return result;
  }

  function member(id, username = id, currentChannel = null) {
    const result = {
      id, user: { username, tag: username, bot: false },
      voice: {
        channelId: currentChannel?.id ?? null,
        async setChannel(destination) {
          calls.moved.push(destination.id);
          guild.channels.cache.get(this.channelId)?.members.delete(id);
          this.channelId = destination.id;
          destination.members.set(id, result);
        },
      },
    };
    currentChannel?.members.set(id, result);
    return result;
  }

  const category = channel('category', { name: 'Voice', type: CHANNEL_TYPES.CATEGORY, parent: null });
  const trigger = channel('trigger', { name: 'Create' });
  const config = { categoryName: 'Voice', channelName: 'Create', highBitrateGuilds: [] };
  const pairs = new Map();
  const settings = new Map([['guild', true]]);
  const database = {
    async insertTextID(...args) { calls.writes.push(args); },
    async deleteTextID(id) { calls.removed.push(id); },
  };
  const state = (value, user) => ({ channel: value, channelId: value?.id ?? null, member: user, guild });
  return { client, calls, guild, channel, member, category, trigger, config, pairs, settings, database, state };
}

function assertPermission(value, name) {
  if (typeof value !== 'bigint') throw new Error(`Unknown permission ${name}`);
}
