const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  Collection,
  ActivityType,
} = require('discord.js')

const config = require('./config.json')

const knex = require('knex')({
  client: 'better-sqlite3',
  connection: {
    filename: './db.sqlite3',
  },
  useNullAsDefault: true,
})

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
})

// Check if tables exist
knex.schema.hasTable('guildSetting').then((exists) => {
  if (!exists) {
    return knex.schema.createTable('guildSetting', (t) => {
      t.increments('id').primary()
      t.string('guild')
      t.boolean('textChannel').defaultTo(false)
    })
  }
})

knex.schema.hasTable('textIDs').then((exists) => {
  if (!exists) {
    return knex.schema.createTable('textIDs', (t) => {
      t.increments('id').primary()
      t.string('voiceChannel')
      t.string('textChannel')
    })
  }
})

let textIDs = new Collection()
let createTextChannel = new Collection()

client.on('ready', () => {
  console.log(
    `${client.user.tag} ready! Watching ${client.guilds.cache.size} guilds.`
  )

  // Load config from database
  knex('guildSetting').then(async (rows) => {
    rows.forEach((row) => {
      console.log('guildSettingDB: ' + row.guild + ' ' + row.textChannel)
      createTextChannel.set(row.guild, row.textChannel)
    })

    // Check if all servers are set
    client.guilds.cache.forEach((guild) => {
      if (!createTextChannel.has(guild.id)) {
        console.log('guildSettingInsert: ' + guild.id + ' false')
        createTextChannel.set(guild.id, false)
        knex('guildSetting')
          .insert({ guild: guild.id, textChannel: false })
          .then(() => {
            console.log('guildSettingInserted: ' + guild.id + ' false')
          })
          .catch((err) => {
            console.log(err)
          })
      }
    })
  })

  // Load textIDs from database
  knex('textIDs').then((rows) => {
    rows.forEach((row) => {
      console.log('textIDsDB: ' + row.voiceChannel + ' ' + row.textChannel)
      textIDs.set(row.voiceChannel, row.textChannel)
    })

    // Check for text channels that dont exist anymore
    textIDs.forEach(async (textChannel, voiceChannel) => {
      try {
        const voice = await client.channels.fetch(voiceChannel)
        const text = await client.channels.fetch(textChannel)
        if (!voice || !text) {
          console.log('textIDsDelete: ' + voiceChannel + ' ' + textChannel)
          textIDs.delete(voiceChannel)
          knex('textIDs')
            .where({ voiceChannel, textChannel })
            .del()
            .then(() => {
              console.log(
                'textIDsDeleted: ' + voiceChannel + ' ' + textChannel
              )
            })
        }
      } catch {
        console.log('textIDsDelete (fetch failed): ' + voiceChannel + ' ' + textChannel)
        textIDs.delete(voiceChannel)
        knex('textIDs')
          .where({ voiceChannel, textChannel })
          .del()
          .catch(console.error)
      }
    })
  })

  // Set status
  client.user.setActivity('for !text', { type: ActivityType.Watching })
})

client.on('messageCreate', (message) => {
  if (message.author.bot) return
  if (message.channel.type === ChannelType.DM) return

  // Check if user has permission to manage channels
  if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels))
    return

  switch (message.content) {
    case '!text':
      const toggle = createTextChannel.get(message.guild.id)
      message.reply(
        !toggle
          ? 'Bot will now create a text channel for every voice channel created.'
          : 'Bot will no longer create a text channel for every voice channel created.'
      )

      console.log('guildSetting: ' + message.guild.id + ' ' + !toggle)

      knex('guildSetting')
        .where('guild', message.guild.id)
        .update({
          textChannel: !toggle,
        })
        .then(() => {
          createTextChannel.set(message.guild.id, !toggle)
        })
      break
    case '!check':
      const createTextChannelSetting = createTextChannel.get(message.guild.id)
      message.reply('Bot is set to: ' + createTextChannelSetting)
      break
  }
})

client.on('voiceStateUpdate', (oldState, newState) => {
  // Only watch user moves
  if (oldState.channelId === newState.channelId) return

  const member = newState.member

  // Fetch Voice Category
  const addCategory = newState.guild.channels.cache.find(
    (channel) =>
      channel.name == config.categoryName &&
      channel.type === ChannelType.GuildCategory
  )

  // Fetch Create Channel
  const addChannel = newState.guild.channels.cache.find(
    (channel) =>
      channel.name == config.channelName &&
      channel.type === ChannelType.GuildVoice
  )

  if (!addChannel) return console.error('No creation channel found')
  if (!addCategory) return console.error('No creation category found')

  // Create new channel
  if (newState.channel == addChannel) {
    addChannel.guild.channels
      .create({
        name: member.user.username.toLowerCase(),
        type: ChannelType.GuildVoice,
        parent: addCategory.id,
        permissionOverwrites: [
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles,
            ],
          },
        ],
      })
      .then((channel) => {
        if (config.highBitrateGuilds.includes(channel.guild.id))
          channel.setBitrate(96000)
        newState.setChannel(channel)

        // Check if setting for server is set
        if (!createTextChannel.get(channel.guild.id)) return

        addChannel.guild.channels
          .create({
            name: member.user.username.toLowerCase(),
            type: ChannelType.GuildText,
            parent: addCategory.id,
            permissionOverwrites: [
              {
                id: member.id,
                allow: [
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.ManageRoles,
                ],
              },
              {
                id: addChannel.guild.id,
                deny: [PermissionFlagsBits.ViewChannel],
              },
              {
                id: client.user.id,
                allow: [
                  PermissionFlagsBits.ManageChannels,
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.ManageRoles,
                ],
              },
            ],
          })
          .then((c) => {
            textIDs.set(channel.id, c.id)
            knex('textIDs')
              .insert({
                voiceChannel: channel.id,
                textChannel: c.id,
              })
              .then(() => console.log('textIDs: ' + channel.id + ' ' + c.id))
          })
      })
      .catch(console.error)
  }

  // User moves from a channel that is not the creation channel
  if (
    createTextChannel.get(newState.guild.id) &&
    oldState.channel &&
    oldState.channel !== addChannel &&
    oldState.channel.parentId == addCategory.id &&
    oldState.channel.members.size > 0
  ) {
    const txtID = textIDs.get(oldState.channel.id)
    if (!txtID) return
    const txtChannel = oldState.guild.channels.cache.get(txtID)
    if (!txtChannel) return
    // Remove the member's permission overwrite
    txtChannel.permissionOverwrites.delete(member.id).catch(console.error)
  }

  // User moves to a channel that is not the creation channel
  if (
    createTextChannel.get(newState.guild.id) &&
    newState.channel &&
    newState.channel !== addChannel &&
    newState.channel.parentId == addCategory.id
  ) {
    const txtID = textIDs.get(newState.channel.id)
    if (txtID) {
      const txtChannel = newState.guild.channels.cache.get(txtID)
      if (txtChannel) {
        txtChannel.permissionOverwrites
          .edit(member.id, {
            ViewChannel: true,
          })
          .catch(console.error)
      }
    }
  }

  // Don't delete add channel
  if (!oldState.channel || oldState.channel === addChannel) return

  // Remove empty channels
  if (
    oldState.channel.parent &&
    oldState.channel.parent === addCategory &&
    oldState.channel.members &&
    oldState.channel.members.size === 0
  ) {
    const oldId = oldState.channel.id
    oldState.channel.delete().catch(console.error)
    // Remove text channel
    if (!createTextChannel.get(oldState.guild.id)) return
    const textChannel = oldState.guild.channels.cache.get(textIDs.get(oldId))
    if (textChannel)
      textChannel
        .delete()
        .then(() => {
          textIDs.delete(oldId)
          knex('textIDs')
            .where('voiceChannel', oldId)
            .del()
            .then(() => console.log('Deleted text channel'))
            .catch(console.error)
        })
        .catch(console.error)
  }

  // Make user owner of channel when original owner leaves
  if (
    oldState.channel.parent &&
    oldState.channel.parent === addCategory &&
    oldState.channel.members &&
    oldState.channel.members.size > 0 &&
    oldState.channel.name === member.user.username
  ) {
    const newOwner = oldState.channel.members.random()
    oldState.channel
      .edit({
        name: newOwner.user.username,
        permissionOverwrites: [
          {
            id: newOwner.id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles,
            ],
          },
        ],
      })
      .catch(console.error)

    if (!createTextChannel.get(oldState.guild.id)) return

    const txtID = textIDs.get(oldState.channel.id)
    if (!txtID) return
    const txtChannel = oldState.guild.channels.cache.get(txtID)
    if (!txtChannel) return

    txtChannel.permissionOverwrites.delete(member.id).catch(() => {})
    txtChannel.permissionOverwrites
      .edit(newOwner.id, {
        ViewChannel: true,
        ManageChannels: true,
        ManageRoles: true,
      })
      .catch(console.error)
    txtChannel.permissionOverwrites
      .edit(client.user.id, {
        ViewChannel: true,
        ManageChannels: true,
        ManageRoles: true,
      })
      .catch(console.error)
  }
})

client.login(config.token).catch(console.error)
