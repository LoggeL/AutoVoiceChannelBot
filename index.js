import { Client, GatewayIntentBits, Collection, ActivityType, Events } from 'discord.js';
import * as db from './src/db.js';
import log from './src/logger.js';
import { setup as setupCommands, register as registerCommands } from './src/commands.js';
import { setup as setupVoiceHandler } from './src/voiceHandler.js';
import { loadState, cleanStaleTextIDs } from './src/startup.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}

const config = {
  categoryName: process.env.CATEGORY_NAME || 'Voice Chat🎤',
  channelName: process.env.CHANNEL_NAME || '➕ Create Channel',
  highBitrateGuilds: process.env.HIGH_BITRATE_GUILDS
    ? process.env.HIGH_BITRATE_GUILDS.split(',').map(s => s.trim()).filter(Boolean)
    : [],
};

const textIDs = new Collection();
const createTextChannel = new Collection();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// Startup failures are logged below even when no event is waiting yet.
ready.catch(() => {});

setupCommands(client, createTextChannel, { ready });
setupVoiceHandler(client, config, textIDs, createTextChannel, { ready });

client.once(Events.ClientReady, async () => {
  try {
    await loadState(client, textIDs, createTextChannel);
    await cleanStaleTextIDs(client, textIDs);
    await registerCommands(client);
    client.user.setActivity('for /text', { type: ActivityType.Watching });
    resolveReady();
    log.info('ready', `${client.user.tag} ready`, { guilds: client.guilds.cache.size });
  } catch (err) {
    rejectReady(err);
    log.error('startup', 'Failed during initialization', { error: err.message });
    await shutdown('startup failure', 1);
  }
});

let stopping;
function shutdown(reason, exitCode = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    log.info('shutdown', 'Shutting down', { reason });
    client.destroy();
    try {
      await db.destroy();
    } catch (err) {
      log.error('shutdown', 'Failed to close database', { error: err.message });
      exitCode = 1;
    }
    process.exit(exitCode);
  })();
  return stopping;
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error('process', 'Unhandled promise rejection', { error: err?.message || String(err) });
});

try {
  await db.init();
  await client.login(token);
} catch (err) {
  rejectReady(err);
  log.error('startup', 'Failed to start bot', { error: err.message });
  await shutdown('startup failure', 1);
}
