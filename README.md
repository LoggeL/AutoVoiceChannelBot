# AutoVoiceChannelBot

A Discord bot that automatically creates temporary voice (and optional text) channels when users join a designated "Create Channel".

## Features

- **Auto voice channels** — joins a trigger channel → gets a personal voice channel
- **Optional text channels** — per-guild toggle to create paired text channels with proper permissions
- **Ownership transfer** — when the creator leaves, ownership passes to a remaining member
- **Auto cleanup** — empty channels are deleted automatically
- **High bitrate** — configurable per-guild high bitrate support

## Setup

1. Clone the repo
2. Copy `config.json.example` → `config.json` and fill in your bot token
3. Create a voice category matching `categoryName` and a voice channel matching `channelName` inside it
4. Give the bot `Manage Channels` permission

### Run directly

```bash
npm install
node index.js
```

### Run with Docker

```bash
docker build -t auto-voice-channel .
docker run -v /path/to/data:/app/data auto-voice-channel
```

The SQLite database is stored at `/app/data/db.sqlite3` (bind-mount for persistence).

## Configuration

| Key | Description |
|-----|-------------|
| `token` | Discord bot token |
| `categoryName` | Name of the voice channel category |
| `channelName` | Name of the trigger voice channel |
| `highBitrateGuilds` | Array of guild IDs that get 96kbps bitrate |

## Commands

| Command | Permission | Description |
|---------|-----------|-------------|
| `!text` | Manage Channels | Toggle text channel creation for the guild |
| `!check` | Manage Channels | Show current text channel creation setting |

## Project Structure

```
index.js              # Entry point, startup, shutdown
src/
  logger.js           # Structured JSON logging
  constants.js        # Permission flags, channel types, command names
  db.js               # SQLite database layer (knex)
  commands.js         # Message command handler
  voiceHandler.js     # Voice state update logic
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |

## License

MIT
