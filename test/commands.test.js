import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { ApplicationCommandOptionType, Events, InteractionContextType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { definitions, register, setup } from '../src/commands.js';

function interaction(commandName = 'text', enabled = null) {
  return {
    commandName, guildId: 'guild', deferred: false, replies: [],
    isChatInputCommand: () => true,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: { getBoolean: () => enabled },
    async deferReply(options) { this.deferred = true; this.deferOptions = options; },
    async editReply(content) { this.replies.push(content); },
    async reply(options) { this.replies.push(options); },
  };
}

function harness(options = {}) {
  const client = new EventEmitter();
  const settings = new Map();
  const writes = [];
  const database = options.database ?? { async updateGuildSetting(...args) { writes.push(args); } };
  const handle = setup(client, settings, { ...options, database });
  assert.equal(client.listenerCount(Events.InteractionCreate), 1);
  assert.equal(client.listenerCount(Events.MessageCreate), 0);
  return { handle, settings, writes };
}

test('registers guild-only slash commands with Manage Channels permissions', async () => {
  let payload;
  await register({ application: { commands: { async set(value) { payload = value; } } } });
  assert.deepEqual(payload.map(command => command.name), ['text', 'check']);
  for (const command of definitions) {
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.equal(command.default_member_permissions, PermissionFlagsBits.ManageChannels.toString());
  }
  assert.equal(payload[0].options[0].type, ApplicationCommandOptionType.Boolean);
  assert.equal(payload[0].options[0].name, 'enabled');
  assert.equal(Boolean(payload[0].options[0].required), false);
});

test('/check reports disabled for a new guild without writing', async () => {
  const h = harness();
  const command = interaction('check');
  await h.handle(command);
  assert.deepEqual(command.deferOptions, { flags: MessageFlags.Ephemeral });
  assert.deepEqual(command.replies, ['Text channel creation is disabled.']);
  assert.deepEqual(h.writes, []);
});

test('/text toggles and accepts explicit true and false', async () => {
  const h = harness();
  for (const enabled of [null, null, true, true, false]) await h.handle(interaction('text', enabled));
  assert.deepEqual(h.writes.map(([, enabled]) => enabled), [true, false, true, true, false]);
  assert.equal(h.settings.get('guild'), false);
});

test('concurrent toggles are serialized, so two toggles restore the setting', async () => {
  const values = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = harness({ database: { async updateGuildSetting(guild, enabled) {
    values.push(enabled);
    if (values.length === 1) await blocked;
  } } });
  const first = h.handle(interaction());
  const secondCommand = interaction();
  const second = h.handle(secondCommand);
  await setImmediate();
  assert.equal(secondCommand.deferred, true);
  assert.deepEqual(values, [true]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(values, [true, false]);
  assert.equal(h.settings.get('guild'), false);
});

test('rejects missing permissions and DMs with ephemeral responses', async () => {
  const h = harness();
  for (const overrides of [{ memberPermissions: null }, { inGuild: () => false }]) {
    const command = Object.assign(interaction(), overrides);
    await h.handle(command);
    assert.equal(command.deferred, false);
    assert.equal(command.replies[0].flags, MessageFlags.Ephemeral);
  }
  assert.deepEqual(h.writes, []);
});

test('ignores unknown commands and other interaction types', async () => {
  const h = harness();
  const unknown = interaction('unrelated');
  await h.handle(unknown);
  const button = Object.assign(interaction(), { isChatInputCommand: () => false });
  await h.handle(button);
  assert.equal(unknown.deferred, false);
  assert.equal(button.deferred, false);
  assert.deepEqual(h.writes, []);
});

test('database failure leaves settings unchanged and the queue usable', async () => {
  let fail = true;
  const h = harness({ database: { async updateGuildSetting() {
    if (fail) throw new Error('database unavailable');
  } } });
  const command = interaction();
  await h.handle(command);
  assert.equal(h.settings.has('guild'), false);
  assert.match(command.replies[0], /could not be completed/);
  fail = false;
  await h.handle(interaction());
  assert.equal(h.settings.get('guild'), true);
});

test('acknowledges immediately but waits for persisted settings to load', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const h = harness({ ready });
  const command = interaction();
  const handling = h.handle(command);
  await setImmediate();
  assert.equal(command.deferred, true);
  assert.deepEqual(h.writes, []);
  h.settings.set('guild', true);
  release();
  await handling;
  assert.deepEqual(h.writes, [['guild', false]]);
});
