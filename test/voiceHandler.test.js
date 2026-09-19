import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { PermissionsBitField, OverwriteType } from 'discord.js';
import { CHANNEL_TYPES, PERMISSIONS } from '../src/constants.js';
import { setup } from '../src/voiceHandler.js';
import { fixture } from './helpers/discord.js';

function handler(f, options = {}) {
  return setup(f.client, f.config, f.pairs, f.settings, { database: f.database, ...options });
}

test('creates a persisted pair before moving, inherits category permissions and sets bitrate in one request', async () => {
  const f = fixture();
  f.category.permissionOverwrites.cache.set('role', {
    id: 'role', type: OverwriteType.Role, allow: new PermissionsBitField(),
    deny: new PermissionsBitField(PERMISSIONS.VIEW_CHANNEL),
  });
  f.config.highBitrateGuilds = ['guild'];
  f.guild.maximumBitrate = 64_000;
  const member = f.member('owner', 'MiXeD', f.trigger);
  const move = member.voice.setChannel.bind(member.voice);
  member.voice.setChannel = async (voice) => {
    assert.equal(f.pairs.get(voice.id), 'created-2');
    assert.deepEqual(f.calls.writes, [['created-1', 'created-2']]);
    await move(voice);
  };
  await handler(f)(f.state(null, member), f.state(f.trigger, member));
  assert.equal(f.calls.created.length, 2);
  assert.equal(f.calls.created[0].bitrate, 64_000);
  assert.equal(f.calls.created[0].name, 'mixed');
  assert.equal(f.calls.created[0].permissionOverwrites.find(value => value.id === 'role').deny, PERMISSIONS.VIEW_CHANNEL);
  assert.deepEqual(f.calls.moved, ['created-1']);
});

test('duplicate concurrent trigger events create only one pair', async () => {
  const f = fixture();
  const member = f.member('owner', 'Owner', f.trigger);
  const handle = handler(f);
  await Promise.all([
    handle(f.state(null, member), f.state(f.trigger, member)),
    handle(f.state(null, member), f.state(f.trigger, member)),
  ]);
  assert.equal(f.calls.created.length, 2);
  assert.equal(f.calls.moved.length, 1);
});

test('a same-named trigger outside the managed category does not create channels', async () => {
  const f = fixture();
  const other = f.channel('other', { name: 'Create', parent: 'elsewhere' });
  const member = f.member('owner', 'Owner', other);
  await handler(f)(f.state(null, member), f.state(other, member));
  assert.deepEqual(f.calls.created, []);
});

test('leaving while voice creation is in flight cleans up instead of moving the user back', async () => {
  const f = fixture();
  const member = f.member('owner', 'Owner', f.trigger);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const create = f.guild.channels.create.bind(f.guild.channels);
  f.guild.channels.create = async options => { await blocked; return create(options); };
  const handling = handler(f)(f.state(null, member), f.state(f.trigger, member));
  await setImmediate();
  member.voice.channelId = null;
  f.trigger.members.delete(member.id);
  release();
  await handling;
  assert.equal(f.calls.created.length, 1);
  assert.deepEqual(f.calls.deleted, ['created-1']);
  assert.deepEqual(f.calls.moved, []);
});

test('failed moves roll back both channels and the persisted pair', async () => {
  const f = fixture();
  const member = f.member('owner', 'Owner', f.trigger);
  member.voice.setChannel = async () => { throw new Error('missing Move Members'); };
  await handler(f)(f.state(null, member), f.state(f.trigger, member));
  assert.deepEqual(f.calls.deleted, ['created-1', 'created-2']);
  assert.deepEqual(f.calls.removed, ['created-1']);
  assert.equal(f.pairs.size, 0);
});

test('failed text persistence rolls back the channels without moving anyone', async () => {
  const f = fixture();
  const member = f.member('owner', 'Owner', f.trigger);
  f.database.insertTextID = async () => { throw new Error('disk full'); };
  await handler(f)(f.state(null, member), f.state(f.trigger, member));
  assert.deepEqual(f.calls.deleted, ['created-1', 'created-2']);
  assert.deepEqual(f.calls.moved, []);
  assert.equal(f.pairs.size, 0);
});

test('existing pairs are deleted even after text creation is disabled', async () => {
  const f = fixture();
  const voice = f.channel('voice');
  f.channel('text', { type: CHANNEL_TYPES.TEXT });
  const member = f.member('owner');
  f.pairs.set('voice', 'text');
  f.settings.set('guild', false);
  await handler(f)(f.state(voice, member), f.state(null, member));
  assert.deepEqual(f.calls.deleted, ['voice', 'text']);
  assert.equal(f.pairs.size, 0);
});

test('ownership follows the owner overwrite after renaming and preserves unrelated permissions', async () => {
  const f = fixture();
  const voice = f.channel('voice', {
    name: 'a renamed room',
    permissionOverwrites: [
      { id: 'owner', allow: [PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.VIEW_CHANNEL] },
      { id: 'role', deny: [PERMISSIONS.VIEW_CHANNEL] },
    ],
  });
  const text = f.channel('text', {
    type: CHANNEL_TYPES.TEXT,
    permissionOverwrites: [{ id: 'owner', allow: [PERMISSIONS.VIEW_CHANNEL] }],
  });
  const owner = f.member('owner', 'MiXeD');
  f.member('next', 'NewOwner', voice);
  f.pairs.set('voice', 'text');
  f.settings.set('guild', false);
  await handler(f)(f.state(voice, owner), f.state(null, owner));
  assert.equal(voice.name, 'newowner');
  assert.equal(voice.permissionOverwrites.cache.get('role').deny.has(PERMISSIONS.VIEW_CHANNEL), true);
  assert.equal(voice.permissionOverwrites.cache.get('owner').allow.has(PERMISSIONS.VIEW_CHANNEL), true);
  assert.equal(voice.permissionOverwrites.cache.get('owner').allow.has(PERMISSIONS.MANAGE_CHANNELS), false);
  assert.equal(voice.permissionOverwrites.cache.get('next').allow.has(PERMISSIONS.MANAGE_CHANNELS), true);
  assert.equal(text.permissionOverwrites.cache.has('owner'), false);
  assert.equal(text.permissionOverwrites.cache.get('next').allow.has(PERMISSIONS.MANAGE_CHANNELS), true);
});

test('joins still grant access to existing text pairs after disabling creation', async () => {
  const f = fixture();
  const voice = f.channel('voice');
  const text = f.channel('text', { type: CHANNEL_TYPES.TEXT });
  const member = f.member('guest', 'Guest', voice);
  f.pairs.set('voice', 'text');
  f.settings.set('guild', false);
  await handler(f)(f.state(null, member), f.state(voice, member));
  assert.equal(text.permissionOverwrites.cache.get('guest').allow.has(PERMISSIONS.VIEW_CHANNEL), true);
});

test('stale leave events do not revoke access after a rapid rejoin', async () => {
  const f = fixture();
  const voice = f.channel('voice');
  const text = f.channel('text', {
    type: CHANNEL_TYPES.TEXT, permissionOverwrites: [{ id: 'owner', allow: [PERMISSIONS.VIEW_CHANNEL] }],
  });
  const member = f.member('owner', 'Owner', voice);
  f.pairs.set('voice', 'text');
  await handler(f)(f.state(voice, member), f.state(null, member));
  assert.equal(text.permissionOverwrites.cache.has('owner'), true);
  assert.deepEqual(f.calls.deleted, []);
});

test('failed text deletion keeps its mapping for a later cleanup attempt', async () => {
  const f = fixture();
  const voice = f.channel('voice');
  const text = f.channel('text', { type: CHANNEL_TYPES.TEXT });
  const member = f.member('owner');
  text.delete = async () => { throw new Error('temporary failure'); };
  f.pairs.set('voice', 'text');
  await handler(f)(f.state(voice, member), f.state(null, member));
  assert.equal(f.pairs.get('voice'), 'text');
  assert.deepEqual(f.calls.removed, []);
});

test('deduplicates queued creation even when Discord acknowledges the move before the gateway cache updates', async () => {
  const f = fixture();
  const member = f.member('owner', 'Owner', f.trigger);
  member.voice.setChannel = async destination => { f.calls.moved.push(destination.id); };
  const handle = handler(f);
  await Promise.all([
    handle(f.state(null, member), f.state(f.trigger, member)),
    handle(f.state(null, member), f.state(f.trigger, member)),
  ]);
  assert.equal(f.calls.created.length, 2);
  assert.equal(f.calls.moved.length, 1);
});
