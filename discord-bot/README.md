# Discord Voice Recording Bot

A Discord bot that records voice channel audio with high-quality settings:
- **Sample Rate:** 44.1kHz
- **Bit Depth:** 16-bit
- **Format:** WAV (uncompressed)
- **Channels:** Dual Channel (Stereo)
- **SNR:** ≥20dB (dependent on user microphone quality)

## Prerequisites

- Node.js 18+ installed
- A Discord account
- A server where you have admin permissions

## Discord Developer Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to **Bot** section in the left sidebar
4. Click "Add Bot" → "Yes, do it!"
5. Under **Privileged Gateway Intents**, enable:
   - ✅ PRESENCE INTENT
   - ✅ SERVER MEMBERS INTENT
   - ✅ MESSAGE CONTENT INTENT
6. Click "Reset Token" and copy your **Bot Token** (save this!)
7. Go to **OAuth2** → **General** and copy your **Client ID**

### 2. Invite the Bot to Your Server

1. Go to **OAuth2** → **URL Generator**
2. Select these scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select these bot permissions:
   - ✅ Connect
   - ✅ Speak
   - ✅ Use Voice Activity
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## Bot Installation

### Option 1: Run Locally

```bash
# Clone or copy this discord-bot folder to your machine
cd discord-bot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your values:
# - DISCORD_BOT_TOKEN: Your bot token from step 1.6
# - DISCORD_CLIENT_ID: Your client ID from step 1.7
# - BOT_API_KEY: The API key you set in Lovable Cloud

# Start the bot
npm start
```

### Option 2: Deploy to Railway (Recommended for 24/7)

1. Go to [railway.app](https://railway.app)
2. Create a new project from GitHub
3. Add environment variables in Railway dashboard
4. Deploy!

### Option 3: Deploy to Heroku

```bash
# Login to Heroku
heroku login

# Create new app
heroku create your-bot-name

# Set config vars
heroku config:set DISCORD_BOT_TOKEN=your_token
heroku config:set DISCORD_CLIENT_ID=your_client_id
heroku config:set BOT_API_KEY=your_api_key
heroku config:set LOVABLE_API_URL=https://qfxustvmwdyjduzpeafk.supabase.co/functions/v1

# Deploy
git push heroku main
```

### Option 4: VPS (DigitalOcean, Linode, etc.)

```bash
# SSH into your server
ssh user@your-server-ip

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your bot
git clone your-repo-url
cd discord-bot

# Install dependencies
npm install

# Use PM2 for process management
npm install -g pm2
pm2 start src/index.js --name discord-bot
pm2 save
pm2 startup
```

## Usage

Once the bot is running and invited to your server:

| Command | Description |
|---------|-------------|
| `/record` | Start recording the voice channel you're in |
| `/stop` | Stop recording and upload the audio |
| `/status` | Check if recording is active |

## Audio Specifications

The bot captures audio with these exact specifications:

| Parameter | Value |
|-----------|-------|
| Sample Rate | 44,100 Hz (CD quality) |
| Bit Depth | 16-bit |
| Channels | 2 (Stereo) |
| Format | WAV (uncompressed) |
| Codec | PCM |

## Troubleshooting

### Bot won't connect to voice
- Ensure the bot has "Connect" and "Speak" permissions
- Check that you're in a voice channel

### No audio captured
- Make sure users are actually speaking
- Verify the bot isn't deafened

### Upload fails
- Check your BOT_API_KEY matches what's in Lovable Cloud
- Verify the LOVABLE_API_URL is correct

### Missing dependencies on Linux
```bash
# Install build tools for native modules
sudo apt-get install build-essential python3
npm rebuild
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Discord Voice  │────▶│  Recording Bot   │────▶│  Lovable Cloud  │
│    Channel      │     │  (Node.js)       │     │  (Storage + DB) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                         │
                               ▼                         ▼
                        ┌──────────────┐         ┌──────────────┐
                        │  Local WAV   │         │  Admin       │
                        │  (Temp)      │         │  Dashboard   │
                        └──────────────┘         └──────────────┘
```
