import * as db from './db.js';
import { fetchChannel, deleteChannel } from './channels.js';
import log from './logger.js';

export async function loadState(client, textIDs, createTextChannel, database = db) {
  const [settings, pairs] = await Promise.all([database.getGuildSettings(), database.getTextIDs()]);
  for (const row of settings) createTextChannel.set(row.guild, Boolean(row.textChannel));
  for (const [id] of client.guilds.cache) {
    if (!createTextChannel.has(id)) createTextChannel.set(id, false);
  }
  for (const row of pairs) textIDs.set(row.voiceChannel, row.textChannel);
}

export async function cleanStaleTextIDs(client, textIDs, database = db) {
  for (const [voiceId, textId] of textIDs) {
    try {
      const voice = await fetchChannel(client.channels, voiceId);
      const text = await fetchChannel(client.channels, textId);
      if (voice && text) continue;
      if (!voice && text) await deleteChannel(text);
      await database.deleteTextID(voiceId);
      textIDs.delete(voiceId);
      log.info('startup', 'Cleaned stale channel pair', { voice: voiceId, text: textId });
    } catch (err) {
      log.warn('startup', 'Kept channel pair for a later cleanup attempt', {
        voice: voiceId, text: textId, error: err.message,
      });
    }
  }
}
