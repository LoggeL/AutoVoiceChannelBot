const { PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  CHANNEL_TYPES: {
    VOICE: ChannelType.GuildVoice,
    TEXT: ChannelType.GuildText,
    CATEGORY: ChannelType.GuildCategory,
    DM: ChannelType.DM,
  },

  PERMISSIONS: {
    MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
    MANAGE_ROLES: PermissionFlagsBits.ManageRoles,
    VIEW_CHANNEL: PermissionFlagsBits.ViewChannel,
  },

  HIGH_BITRATE: 96_000,

  COMMANDS: {
    TEXT: '!text',
    CHECK: '!check',
  },
};
