const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const config = require('./config.json');
const db = require('./src/db');
const log = require('./src/logger');
const commands = require('./src/commands');
const voiceHandler = require('./src/voiceHandler');

const textIDs = new Collection();
const createTextChannel = new Collection();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

async function loadGuildSettings() {
  const rows = await db.getGuildSettings();
  for (const row of rows) {
    createTextChannel.set(row.guild, Boolean(row.textChannel));
    log.debug('startup', 'Loaded guild setting', { guild: row.guild, textChannel: row.textChannel });
  }

  for (const [id] of client.guilds.cache) {
    if (!createTextChannel.has(id)) {
      createTextChannel.set(id, false);
      await db.insertGuildSetting(id, false);
      log.info('startup', 'Inserted default guild setting', { guild: id });
    }
  }
}

async function cleanStaleTextIDs() {
  const rows = await db.getTextIDs();
  for (const row of rows) {
    textIDs.set(row.voiceChannel, row.textChannel);
    log.debug('startup', 'Loaded textID mapping', { voice: row.voiceChannel, text: row.textChannel });
  }

  for (const [voiceId, textId] of textIDs) {
    try {
      const voice = await client.channels.fetch(voiceId);
      const text = await client.channels.fetch(textId);
      if (!voice || !text) throw new Error('Channel missing');
    } catch {
      log.info('startup', 'Cleaning stale textID mapping', { voice: voiceId, text: textId });
      textIDs.delete(voiceId);
      await db.deleteTextIDByBoth(voiceId, textId).catch((err) =>
        log.error('startup', 'Failed to clean stale textID', { error: err.message })
      );
    }
  }
}

client.once('ready', async () => {
  log.info('ready', `${client.user.tag} ready`, { guilds: client.guilds.cache.size });

  try {
    await loadGuildSettings();
    await cleanStaleTextIDs();
  } catch (err) {
    log.error('startup', 'Failed during initialization', { error: err.message });
  }

  client.user.setActivity('for !text', { type: ActivityType.Watching });
});

// Register event handlers
commands.setup(client, createTextChannel);
voiceHandler.setup(client, config, textIDs, createTextChannel);

// Graceful shutdown
async function shutdown(signal) {
  log.info('shutdown', `Received ${signal}, shutting down gracefully`);
  client.destroy();
  await db.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error('process', 'Unhandled promise rejection', { error: err?.message || String(err) });
});

// Start
(async () => {
  try {
    await db.init();
    await client.login(config.token);
  } catch (err) {
    log.error('startup', 'Failed to start bot', { error: err.message });
    process.exit(1);
  }
})();
