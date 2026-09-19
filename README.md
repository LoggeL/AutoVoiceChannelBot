# AutoVoiceChannelBot

A Discord bot that creates temporary voice channels when users join a designated creation channel. Each server can optionally enable a private text channel for every new voice channel.

## Setup

1. Create a bot in the Discord Developer Portal and set its token in the `DISCORD_TOKEN` environment variable.
2. Install the application on your server with the `bot` and `applications.commands` scopes.
3. Give the bot View Channels, Manage Channels, Manage Roles, Connect, and Move Members permissions in the managed category. Place its role high enough to manage the relevant permission overwrites.
4. Create a category named `Voice Chat🎤` and a voice channel named `➕ Create Channel` inside it, or configure other names using the variables below. Use a dedicated category: empty voice channels inside it are deleted when members leave, except for the creation channel.
5. Start the bot. It registers `/text` and `/check` automatically as global application commands restricted to servers.

The bot uses the Guilds and Guild Voice States gateway intents. Message Content and Server Members privileged intents are not required.

### Run directly

Requires Node.js 20 or newer. Export `DISCORD_TOKEN` in your shell or configure it in your process manager before starting.

```bash
npm ci
npm start
```

The bot reads environment variables directly. It does not automatically load a `.env` file.

### Run with Docker

With `DISCORD_TOKEN` exported in the host shell:

```bash
docker build -t auto-voice-channel .
docker run -d --name auto-voice-channel --restart unless-stopped \
  --env DISCORD_TOKEN \
  --mount type=bind,source=/absolute/path/to/data,target=/app/data \
  auto-voice-channel
```

Create the host data directory before running the container. The database is stored at `/app/data/db.sqlite3` in Docker and at `./db.sqlite3` when running directly.

## Commands

Both commands require Manage Channels permission. Replies are visible only to the person who invokes the command.

| Command | Behavior |
|---------|----------|
| `/text` | Toggle text channel creation for the server |
| `/text enabled:true` | Enable text channels for new voice channels |
| `/text enabled:false` | Disable text channels for new voice channels |
| `/check` | Show the current setting, which defaults to disabled |

Existing text channel pairs continue to receive membership updates and are cleaned up when their voice channel becomes empty, even after creation is disabled. Simultaneous commands for a server are processed sequentially.

### Upgrading from prefix commands

`!text` and `!check` are replaced by `/text` and `/check`. Restart the updated bot to register the commands. If they do not appear, verify the application's installation includes `applications.commands` and allow Discord's client to refresh its command list.

Existing SQLite settings and channel mappings are retained. On startup, the bot adds unique indexes and consolidates duplicate records using the latest saved row. Keep a backup of the database before upgrading. Configuration uses environment variables; `config.json` is no longer read.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_TOKEN` | Required | Discord bot token |
| `CATEGORY_NAME` | `Voice Chat🎤` | Category containing temporary voice channels |
| `CHANNEL_NAME` | `➕ Create Channel` | Creation voice channel inside that category |
| `HIGH_BITRATE_GUILDS` | Empty | Comma-separated server IDs that use 96 kbps, capped at the server limit |
| `DATABASE_PATH` | `./db.sqlite3` | SQLite file path; its parent directory must exist |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

## Channel lifecycle

Voice events are processed sequentially per server. The bot persists text channel mappings before moving a member into a newly created voice channel. If the member leaves the creation channel while setup is in progress, the bot removes the empty channels instead of moving them back.

When the owner leaves, a remaining member receives ownership. Ownership is recognized by the member's Manage Channels and Manage Roles overwrite, so renaming the channel does not break transfer. Unrelated channel overwrites are preserved.

At startup, stale mappings are removed only when Discord confirms a channel is missing. An orphaned text channel is deleted along with its mapping. Permission and network errors keep the mapping for a later startup attempt.

## Development

```bash
npm run check
```

This checks the entry point's syntax and runs the Node.js test suite. Tests cover slash commands, concurrent events, permission changes, creation rollback, startup cleanup, and migration against real SQLite databases. Discord operations are simulated; these tests do not connect to a live server.

## License

MIT
