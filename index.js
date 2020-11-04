const Discord = require('discord.js')
const client = new Discord.Client()
const config = require('./config.json')

let textIDs = new Discord.Collection()

client.on('ready', () => {
    console.log(`${client.user.tag} ready! Watching ${client.guilds.cache.size} guilds.`)

    client.guilds.cache.forEach(guild => {
        const addCategory = guild.channels.cache.find(channel => channel.name == config.categoryName && channel.type === "category")
        if (addCategory) {
            guild.channels.cache.forEach(channel => {
                if (channel.parentID === addCategory.id && channel.name !== config.channelName && channel.guild.id === config.testGuild && channel.deletable) channel.delete()
            })
        }
    })
})

client.on('voiceStateUpdate', (oldState, newState) => {
    // Only watch user moves
    if (oldState.channelID === newState.channelID) return

    const member = newState.member

    // Fetch Voice Category
    const addCategory = newState.guild.channels.cache.find(channel => channel.name == config.categoryName && channel.type === "category")

    // Fetch Create Channel channel
    const addChannel = newState.guild.channels.cache.find(channel => channel.name == config.channelName && channel.type === "voice")

    // Does it exist?
    if (!addChannel) return console.error('No creation channel found')
    if (!addCategory) return console.error('No creation category found')

    // Create new channel
    if (newState.channel == addChannel) {
        addChannel.guild.channels.create("◾ " + member.user.username, {
            type: 'voice',
            parent: addCategory.id,
            permissionOverwrites: [{
                id: member.id,
                allow: ['MANAGE_CHANNELS']
            }]
        }).then(channel => {
            newState.setChannel(channel)
            addChannel.guild.channels.create("◾ " + member.user.username, {
                type: 'text',
                parent: addCategory.id,
                position: channel.rawPosition + 1,
                permissionOverwrites: [{
                    id: member.id,
                    allow: ['MANAGE_CHANNELS', 'VIEW_CHANNEL']
                }, {
                    id: addChannel.guild.id,
                    deny: ['VIEW_CHANNEL']
                }]
            }).then(c => {
                textIDs.set(channel.id, c.id)
            })
        }).catch(console.error)
    }

    if (oldState.channel && oldState.channel !== addChannel && oldState.channel.parentID == addCategory.id) {
        const txtID = textIDs.get(oldState.channel.id)
        if (!txtID) return
        const txtChannel = oldState.guild.channels.cache.get(txtID)
        let overWrites = txtChannel.permissionOverwrites.array()
        overWrites = overWrites.filter(oW => oW.id !== member.id)
        txtChannel.overwritePermissions(overWrites)
    }

    if (newState.channel && newState.channel !== addChannel && newState.channel.parentID == addCategory.id) {
        const txtID = textIDs.get(newState.channel.id)
        if (!txtID) return
        const txtChannel = newState.guild.channels.cache.get(txtID)
        let overWrites = txtChannel.permissionOverwrites.array()
        let personalOverwrites = overWrites.find(oW => overWrites.id === member.id)
        if (personalOverwrites) delete personalOverwrites
        overWrites.push({
            id: member.id,
            allow: ['VIEW_CHANNEL']
        })
        txtChannel.overwritePermissions(overWrites)
    }

    // Don't delete add channel
    if (!oldState.channel || oldState.channel === addChannel) return

    // Remove empty channels
    if (oldState.channel.parent && oldState.channel.parent === addCategory && oldState.channel.members && oldState.channel.members.size === 0) {
        const textChannel = oldState.guild.channels.cache.get(textIDs.get(oldState.channel.id))
        textChannel.delete().then(() => {
            oldState.channel.delete().catch(console.error)
            textIDs.delete(oldState.channel.id)
        }).catch(console.error)
        return
    }

    if (oldState.channel.parent && oldState.channel.parent === addCategory && oldState.channel.members && oldState.channel.members.size > 0 && oldState.channel.name === "◾ " + member.user.username) {
        const newOwner = oldState.channel.members.random()
        oldState.channel.edit({
            name: "◾ " + newOwner.user.username,
            type: 'voice',
            parent: addCategory.id,
            permissionOverwrites: [{
                id: newOwner.id,
                allow: ['MANAGE_CHANNELS']
            }]
        }).catch(console.error)

        const txtID = textIDs.get(oldState.channel.id)
        if (!txtID) return
        const txtChannel = oldState.guild.channels.cache.get(txtID)
        let overWrites = txtChannel.permissionOverwrites.array()
        let personalOverwrites = overWrites.find(oW => overWrites.id === member.id)
        if (personalOverwrites) delete personalOverwrites
        overWrites.push({
            id: newOwner.id,
            allow: ['VIEW_CHANNEL', 'MANAGE_CHANNELS']
        })
        txtChannel.edit({
            name: "◾ " + newOwner.user.username,
            type: 'text',
            parent: addCategory.id,
            permissionOverwrites: overWrites
        })
    }
    // ToDo 
    // ???
})

client.login(config.token).catch(console.error)