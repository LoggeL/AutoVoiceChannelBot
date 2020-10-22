const Discord = require('discord.js')
const client = new Discord.Client()
const config = require('./config.json')

client.on('ready', () => {
    console.log(`${client.user.tag} ready! Watching ${client.guilds.cache.size} guilds.`)
})

client.on('voiceStateUpdate', (oldState, newState) => {
    // Only watch user moves
    if (oldState.channelID === newState.channelID) return

    const member = newState.member

    // Fetch Voice Category
    const addCategory = newState.guild.channels.cache.find(channel => channel.name == "Voice Chat 🎤" && channel.type === "category")

    // Fetch Create Channel channel
    const addChannel = newState.guild.channels.cache.find(channel => channel.name == '➕ Create Channel' && channel.type === "voice")

    // Does it exist?
    if (!addChannel) return console.error('No creation channel found')

    if (newState.channel == addChannel) {
        addChannel.guild.channels.create("-> " + member.user.username, {
            type: 'voice',
            parent: addCategory,
            permissionOverwrites: [{
                id: member.id,
                allow: ['MANAGE_CHANNELS']
            }]
        }).then(channel => {
            newState.setChannel(channel)
        }).catch(console.error)
    }

    if (!oldState.channel || oldState.channel === addChannel) return

    if (oldState.channel.parent && oldState.channel.parent === addCategory && oldState.channel.members && oldState.channel.members.size === 0) {
        oldState.channel.delete().catch(console.error)
        return
    }
})

client.login(config.token).catch(console.error)