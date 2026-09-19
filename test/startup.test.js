import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStaleTextIDs, loadState } from '../src/startup.js';
import { CHANNEL_TYPES } from '../src/constants.js';
import { fixture } from './helpers/discord.js';

test('loads saved settings and supplies false for a newly joined guild', async () => {
  const f = fixture();
  await loadState(f.client, f.pairs, f.settings, {
    async getGuildSettings() { return [{ guild: 'other', textChannel: 1 }]; },
    async getTextIDs() { return [{ voiceChannel: 'voice', textChannel: 'text' }]; },
  });
  assert.equal(f.settings.get('other'), true);
  assert.equal(f.pairs.get('voice'), 'text');
  f.settings.clear();
  await loadState(f.client, f.pairs, f.settings, {
    async getGuildSettings() { return []; }, async getTextIDs() { return []; },
  });
  assert.equal(f.settings.get('guild'), false);
});

test('removes the orphaned text channel when its voice channel no longer exists', async () => {
  const f = fixture();
  f.channel('text', { type: CHANNEL_TYPES.TEXT });
  f.pairs.set('missing-voice', 'text');
  await cleanStaleTextIDs(f.client, f.pairs, f.database);
  assert.deepEqual(f.calls.deleted, ['text']);
  assert.equal(f.pairs.size, 0);
});

test('Unknown Channel removes a stale mapping while preserving an existing voice channel', async () => {
  const f = fixture();
  const voice = f.channel('voice');
  f.client.channels.fetch = async id => {
    if (id === 'voice') return voice;
    throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
  };
  f.pairs.set('voice', 'missing-text');
  await cleanStaleTextIDs(f.client, f.pairs, f.database);
  assert.deepEqual(f.calls.deleted, []);
  assert.deepEqual(f.calls.removed, ['voice']);
  assert.equal(f.pairs.size, 0);
});

test('temporary network failures and missing permissions preserve mappings', async () => {
  for (const code of [50013, 50001, 'ECONNRESET']) {
    const f = fixture();
    f.pairs.set('voice', 'text');
    f.client.channels.fetch = async () => { throw Object.assign(new Error('unavailable'), { code }); };
    await cleanStaleTextIDs(f.client, f.pairs, f.database);
    assert.equal(f.pairs.get('voice'), 'text');
    assert.deepEqual(f.calls.removed, []);
  }
});

test('failed orphan deletion preserves the mapping for retry on the next startup', async () => {
  const f = fixture();
  const text = f.channel('text', { type: CHANNEL_TYPES.TEXT });
  text.delete = async () => { throw new Error('unavailable'); };
  f.pairs.set('voice', 'text');
  await cleanStaleTextIDs(f.client, f.pairs, f.database);
  assert.equal(f.pairs.get('voice'), 'text');
  assert.deepEqual(f.calls.removed, []);
});
