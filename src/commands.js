const { COMMANDS, CHANNEL_TYPES, PERMISSIONS } = require('./constants');
const db = require('./db');
const log = require('./logger');

function setup(client, createTextChannel) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.type === CHANNEL_TYPES.DM) return;
    if (!message.member.permissions.has(PERMISSIONS.MANAGE_CHANNELS)) return;

    try {
      switch (message.content) {
        case COMMANDS.TEXT: {
          const current = createTextChannel.get(message.guild.id);
          const toggled = !current;
          await db.updateGuildSetting(message.guild.id, toggled);
          createTextChannel.set(message.guild.id, toggled);
          await message.reply(
            toggled
              ? 'Bot will now create a text channel for every voice channel created.'
              : 'Bot will no longer create a text channel for every voice channel created.'
          );
          log.info('command', 'Toggled text channel setting', { guild: message.guild.id, value: toggled });
          break;
        }
        case COMMANDS.CHECK: {
          const setting = createTextChannel.get(message.guild.id);
          await message.reply(`Bot is set to: ${setting}`);
          break;
        }
      }
    } catch (err) {
      log.error('command', 'Failed to handle command', { error: err.message, command: message.content });
    }
  });
}

module.exports = { setup };
