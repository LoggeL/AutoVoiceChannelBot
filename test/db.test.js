import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import knex from 'knex';
import * as db from '../src/db.js';

afterEach(() => db.destroy());

test('guild settings and text pairs upsert into a single row', async () => {
  await db.init(':memory:');
  await db.updateGuildSetting('new-guild', true);
  await db.updateGuildSetting('new-guild', false);
  assert.deepEqual(await db.getGuildSettings(), [{ guild: 'new-guild', textChannel: 0 }]);
  await db.insertTextID('voice', 'first');
  await db.insertTextID('voice', 'second');
  assert.deepEqual(await db.getTextIDs(), [{ voiceChannel: 'voice', textChannel: 'second' }]);
  await db.deleteTextID('voice');
  assert.deepEqual(await db.getTextIDs(), []);
});

test('migration keeps the latest duplicate values and survives reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'auto-voice-test-'));
  const filename = join(directory, 'legacy.sqlite3');
  try {
    const legacy = knex({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
    try {
      await legacy.schema.createTable('guildSetting', t => {
        t.increments('id').primary(); t.string('guild'); t.boolean('textChannel');
      });
      await legacy.schema.createTable('textIDs', t => {
        t.increments('id').primary(); t.string('voiceChannel'); t.string('textChannel');
      });
      await legacy('guildSetting').insert([
        { guild: 'guild', textChannel: false }, { guild: 'guild', textChannel: true },
      ]);
      await legacy('textIDs').insert([
        { voiceChannel: 'voice', textChannel: 'old' }, { voiceChannel: 'voice', textChannel: 'current' },
      ]);
    } finally {
      await legacy.destroy();
    }
    await db.init(filename);
    assert.deepEqual(await db.getGuildSettings(), [{ guild: 'guild', textChannel: 1 }]);
    assert.deepEqual(await db.getTextIDs(), [{ voiceChannel: 'voice', textChannel: 'current' }]);
    await db.updateGuildSetting('guild', false);
    await db.insertTextID('voice', 'updated');
    await db.destroy();
    await db.init(filename);
    assert.deepEqual(await db.getGuildSettings(), [{ guild: 'guild', textChannel: 0 }]);
    assert.deepEqual(await db.getTextIDs(), [{ voiceChannel: 'voice', textChannel: 'updated' }]);
  } finally {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
