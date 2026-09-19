import { Events, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COMMANDS, PERMISSIONS } from './constants.js';
import { createQueue } from './queue.js';
import * as db from './db.js';
import log from './logger.js';

export const definitions = [
  new SlashCommandBuilder()
    .setName(COMMANDS.TEXT)
    .setDescription('Enable or disable text channels for new temporary voice channels.')
    .setDefaultMemberPermissions(PERMISSIONS.MANAGE_CHANNELS)
    .setContexts(InteractionContextType.Guild)
    .addBooleanOption(option => option
      .setName('enabled')
      .setDescription('Enable or disable explicitly. Omit to toggle the current setting.')),
  new SlashCommandBuilder()
    .setName(COMMANDS.CHECK)
    .setDescription('Show whether new temporary voice channels get a text channel.')
    .setDefaultMemberPermissions(PERMISSIONS.MANAGE_CHANNELS)
    .setContexts(InteractionContextType.Guild),
].map(command => command.toJSON());

export async function register(client) {
  await client.application.commands.set(definitions);
  log.info('command', 'Registered slash commands');
}

export function setup(client, createTextChannel, { database = db, ready = Promise.resolve() } = {}) {
  const enqueue = createQueue();

  const handleInteraction = async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!definitions.some(command => command.name === interaction.commandName)) return;

    try {
      if (!interaction.inGuild() || !interaction.memberPermissions?.has(PERMISSIONS.MANAGE_CHANNELS)) {
        await interaction.reply({
          content: 'You need Manage Channels permission in a server to use this command.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Acknowledge before waiting for startup or another command in this guild.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await ready;
      await enqueue(interaction.guildId, async () => {
        const current = createTextChannel.get(interaction.guildId) ?? false;
        if (interaction.commandName === COMMANDS.CHECK) {
          await interaction.editReply(`Text channel creation is ${current ? 'enabled' : 'disabled'}.`);
          return;
        }

        const enabled = interaction.options.getBoolean('enabled') ?? !current;
        await database.updateGuildSetting(interaction.guildId, enabled);
        createTextChannel.set(interaction.guildId, enabled);
        await interaction.editReply(enabled
          ? 'New temporary voice channels will now get a text channel.'
          : 'New temporary voice channels will no longer get a text channel. Existing pairs will still be managed.');
        log.info('command', 'Updated text channel setting', { guild: interaction.guildId, value: enabled });
      });
    } catch (err) {
      log.error('command', 'Failed to handle command', { error: err.message, command: interaction.commandName });
      try {
        const content = 'The command could not be completed. Please try again.';
        if (interaction.deferred || interaction.replied) await interaction.editReply(content);
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      } catch (replyError) {
        log.error('command', 'Failed to send command error', { error: replyError.message });
      }
    }
  };

  client.on(Events.InteractionCreate, handleInteraction);
  return handleInteraction;
}
