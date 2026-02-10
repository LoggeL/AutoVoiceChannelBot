import { PermissionFlagsBits, ChannelType } from 'discord.js';

export const CHANNEL_TYPES = {
  VOICE: ChannelType.GuildVoice,
  TEXT: ChannelType.GuildText,
  CATEGORY: ChannelType.GuildCategory,
};

export const PERMISSIONS = {
  MANAGE_CHANNELS: PermissionFlagsBits.ManageChannels,
  MANAGE_ROLES: PermissionFlagsBits.ManageRoles,
  VIEW_CHANNEL: PermissionFlagsBits.ViewChannel,
};

export const HIGH_BITRATE = 96_000;

export const COMMANDS = {
  TEXT: '!text',
  CHECK: '!check',
};
