import { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, ChannelType } from 'discord.js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType
} from '@discordjs/voice';
import { opus } from 'prism-media';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
const dotenvResult = dotenv.config({ path: envPath });

const maskSecret = (value) => {
  if (!value) return '(missing)';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

console.log('🔧 Env loaded:', {
  cwd: process.cwd(),
  envPath,
  dotenvError: dotenvResult?.error?.message || null,
  parsedKeys: dotenvResult?.parsed ? Object.keys(dotenvResult.parsed) : [],
  hasLovableApiUrl: !!process.env.LOVABLE_API_URL,
  hasBotApiKey: !!process.env.BOT_API_KEY,
  botApiKey: maskSecret(process.env.BOT_API_KEY)
});

// Configuration - Discord voice uses 48kHz
const CONFIG = {
  SAMPLE_RATE: 48000,
  BIT_DEPTH: 16,
  CHANNELS: 2,
  RECORDINGS_DIR: './recordings',
  TEMP_CHANNEL_PREFIX: '🎙️',
  TEMP_CHANNEL_TIMEOUT_MS: 5 * 60 * 1000 // 5 minutes idle timeout
};

// Create recordings directory
if (!existsSync(CONFIG.RECORDINGS_DIR)) {
  mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Active recordings map
const activeRecordings = new Map();

// Temporary channels map: channelId -> { creatorId, createdAt, guildId }
const temporaryChannels = new Map();

// WAV Header creation for 44.1kHz, 16-bit, stereo
function createWavHeader(dataLength) {
  const buffer = Buffer.alloc(44);
  const byteRate = CONFIG.SAMPLE_RATE * CONFIG.CHANNELS * (CONFIG.BIT_DEPTH / 8);
  const blockAlign = CONFIG.CHANNELS * (CONFIG.BIT_DEPTH / 8);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  
  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM = 1)
  buffer.writeUInt16LE(CONFIG.CHANNELS, 22);
  buffer.writeUInt32LE(CONFIG.SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(CONFIG.BIT_DEPTH, 34);
  
  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

// Audio mixer for combining multiple user streams
// NOTE: we must NOT delete a user's chunks when they stop speaking,
// otherwise /stop will often say "No audio was captured".
class AudioMixer {
  constructor() {
    // userId -> { stream: AudioReceiveStream | null, chunks: Array<{timestamp:number, data:Buffer}> }
    this.streams = new Map();
    this.startTime = Date.now();
  }

  hasActiveStream(userId) {
    const entry = this.streams.get(userId);
    return !!entry?.stream;
  }

  addStream(userId, stream) {
    const existing = this.streams.get(userId);
    if (existing) {
      existing.stream = stream;
      return;
    }

    this.streams.set(userId, { stream, chunks: [] });
  }

  removeStream(userId) {
    // Keep chunks for final mix; only mark stream as inactive.
    const existing = this.streams.get(userId);
    if (existing) existing.stream = null;
  }

  addChunk(userId, chunk) {
    if (!this.streams.has(userId)) {
      this.streams.set(userId, { stream: null, chunks: [] });
    }

    this.streams.get(userId).chunks.push({
      timestamp: Date.now() - this.startTime,
      data: chunk
    });
  }

  getMixedAudio() {
    // Collect all chunks and mix them
    const allChunks = [];

    for (const [, { chunks }] of this.streams) {
      for (const chunk of chunks) {
        allChunks.push(chunk);
      }
    }

    // Sort by timestamp
    allChunks.sort((a, b) => a.timestamp - b.timestamp);

    // Combine all audio data
    const totalLength = allChunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const mixedBuffer = Buffer.alloc(totalLength);
    let offset = 0;

    for (const chunk of allChunks) {
      chunk.data.copy(mixedBuffer, offset);
      offset += chunk.data.length;
    }

    return mixedBuffer;
  }

  getDuration() {
    return (Date.now() - this.startTime) / 1000;
  }
}

// Start recording a voice channel
async function startRecording(interaction) {
  const voiceChannel = interaction.member.voice.channel;
  
  if (!voiceChannel) {
    await interaction.reply({ content: '❌ You must be in a voice channel!', ephemeral: true });
    return;
  }

  // Fast-fail with a clear error if the bot cannot connect (most common cause of ABORT_ERR)
  const me = interaction.guild?.members?.me;
  const permissions = me ? voiceChannel.permissionsFor(me) : null;
  if (permissions) {
    const missing = [];
    if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
    if (!permissions.has(PermissionFlagsBits.Connect)) missing.push('Connect');

    if (missing.length > 0) {
      await interaction.reply({
        content: `❌ I can't join **${voiceChannel.name}**. Missing permissions: ${missing.join(', ')}.\n\nFix: allow the bot to View Channel + Connect for that voice channel.`,
        ephemeral: true
      });
      return;
    }
  } else {
    console.warn('⚠️ Could not resolve bot member permissions (guild.members.me missing). Continuing...');
  }

  if (activeRecordings.has(voiceChannel.id)) {
    await interaction.reply({ content: '⚠️ Already recording in this channel!', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    console.log(`🔗 Joining voice channel: ${voiceChannel.name} (${voiceChannel.id})`);
    
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true
    });

    // Add connection state listeners for debugging
    connection.on('stateChange', (oldState, newState) => {
      console.log(`🔁 Voice connection state: ${oldState.status} -> ${newState.status}`);
    });

    connection.on(VoiceConnectionStatus.Connecting, () => {
      console.log('📡 Voice connection: Connecting...');
    });
    
    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log('✅ Voice connection: Ready!');
    });
    
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      console.log('⚠️ Voice connection: Disconnected');
    });
    
    connection.on('error', (error) => {
      console.error('❌ Voice connection error:', error.message);
    });

    // Wait for connection with longer timeout
    await entersState(connection, VoiceConnectionStatus.Ready, 60_000);

    const mixer = new AudioMixer();
    const receiver = connection.receiver;

    // Track when users start speaking
    receiver.speaking.on('start', (userId) => {
      // Skip if we're already subscribed to this user's audio
      if (mixer.hasActiveStream(userId)) return;
      
      console.log(`🎤 User ${userId} started speaking - subscribing to audio...`);
      
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 2000
        }
      });

      mixer.addStream(userId, audioStream);
      let chunkCount = 0;

      // Try to create opus decoder
      let decoder = null;
      try {
        decoder = new opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960
        });
        console.log(`✅ Opus decoder created for user ${userId}`);
        
        decoder.on('error', (err) => {
          console.error(`❌ Decoder error for user ${userId}:`, err.message);
        });

        decoder.on('data', (chunk) => {
          chunkCount++;
          if (chunkCount % 50 === 1) {
            console.log(`📊 User ${userId}: received ${chunkCount} decoded chunks (${chunk.length} bytes each)`);
          }
          mixer.addChunk(userId, chunk);
        });

        audioStream.pipe(decoder);
        
      } catch (err) {
        console.error(`❌ Failed to create decoder: ${err.message}`);
        console.log(`⚠️ Falling back to raw audio capture for user ${userId}`);
        decoder = null;
      }

      // Fallback: capture raw audio if decoder failed
      if (!decoder) {
        audioStream.on('data', (chunk) => {
          chunkCount++;
          if (chunkCount % 50 === 1) {
            console.log(`📊 User ${userId}: received ${chunkCount} raw chunks (${chunk.length} bytes each)`);
          }
          mixer.addChunk(userId, chunk);
        });
      }

      audioStream.on('error', (err) => {
        console.error(`❌ Audio stream error for user ${userId}:`, err.message);
      });

      audioStream.on('end', () => {
        console.log(`🔇 User ${userId} stopped speaking - total chunks: ${chunkCount}`);
        mixer.removeStream(userId);
      });
    });

    activeRecordings.set(voiceChannel.id, {
      connection,
      mixer,
      voiceChannel,
      startTime: new Date(),
      guild: interaction.guild
    });

    await interaction.editReply({
      content: `🔴 **Recording started** in ${voiceChannel.name}\n\n` +
               `📊 **Audio Settings:**\n` +
               `• Sample Rate: ${CONFIG.SAMPLE_RATE}Hz\n` +
               `• Bit Depth: ${CONFIG.BIT_DEPTH}-bit\n` +
               `• Channels: Stereo (${CONFIG.CHANNELS} channels)\n` +
               `• Format: WAV (uncompressed)\n\n` +
               `Use \`/stop\` to end recording and upload.`
    });

  } catch (error) {
    console.error('Error starting recording:', error);

    const isAbort = error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
    const hint = isAbort
      ? '\n\nCommon causes: bot lacks Connect permission for the voice channel, or UDP voice traffic is blocked by a firewall/VPN/router. '
      : '';

    await interaction.editReply({ content: '❌ Failed to start recording: ' + error.message + hint });
  }
}

// Stop recording and upload
async function stopRecording(interaction) {
  const voiceChannel = interaction.member.voice.channel;

  if (!voiceChannel || !activeRecordings.has(voiceChannel.id)) {
    await interaction.reply({ content: '❌ No active recording in your voice channel!', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const recording = activeRecordings.get(voiceChannel.id);
  const { connection, mixer, guild } = recording;

  try {
    // Stop the connection
    connection.destroy();
    activeRecordings.delete(voiceChannel.id);

    // Get mixed audio
    const audioData = mixer.getMixedAudio();
    const duration = mixer.getDuration();

    if (audioData.length === 0) {
      await interaction.editReply({ content: '⚠️ No audio was captured. Make sure users were speaking!' });
      return;
    }

    // Create WAV file
    const wavHeader = createWavHeader(audioData.length);
    const wavBuffer = Buffer.concat([wavHeader, audioData]);
    
    const filename = `recording_${Date.now()}.wav`;
    const filepath = `${CONFIG.RECORDINGS_DIR}/${filename}`;
    
    // Save locally first
    const writeStream = createWriteStream(filepath);
    writeStream.write(wavBuffer);
    writeStream.end();

    await new Promise((resolve) => writeStream.on('finish', resolve));

    // Upload to Lovable Cloud
    await interaction.editReply({ content: '⏳ Uploading recording to cloud...' });

    const formData = new FormData();
    formData.append('audio', readFileSync(filepath), {
      filename: filename,
      contentType: 'audio/wav'
    });
    formData.append('metadata', JSON.stringify({
      discord_guild_id: guild.id,
      discord_guild_name: guild.name,
      discord_channel_id: voiceChannel.id,
      discord_channel_name: voiceChannel.name,
      discord_user_id: interaction.user.id,
      discord_username: interaction.user.username,
      filename: filename,
      duration_seconds: duration,
      extra: {
        recorded_by: interaction.user.tag,
        member_count: voiceChannel.members.size
      }
    }));

    if (!process.env.LOVABLE_API_URL) {
      throw new Error('LOVABLE_API_URL is not set. Check your .env and restart the bot.');
    }
    if (!process.env.BOT_API_KEY) {
      throw new Error('BOT_API_KEY is not set (or .env not loaded). Check your .env and restart the bot.');
    }

    const response = await fetch(`${process.env.LOVABLE_API_URL}/upload-recording`, {
      method: 'POST',
      headers: {
        'x-bot-api-key': process.env.BOT_API_KEY
      },
      body: formData
    });

    // Clean up local file
    unlinkSync(filepath);

    // Handle response - check for non-JSON responses
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse response:', responseText.substring(0, 500));
      throw new Error(`Server returned invalid response (status ${response.status}): ${responseText.substring(0, 200)}`);
    }

    if (response.ok) {
      await interaction.editReply({
        content: `✅ **Recording saved!**\n\n` +
                 `📁 **File:** ${filename}\n` +
                 `⏱️ **Duration:** ${duration.toFixed(1)} seconds\n` +
                 `📊 **Size:** ${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB\n` +
                 `🔗 **URL:** ${result.file_url}\n\n` +
                 `Audio recorded at ${CONFIG.SAMPLE_RATE / 1000}kHz, ${CONFIG.BIT_DEPTH}-bit, stereo WAV`
      });
    } else {
      throw new Error(result.error || 'Upload failed');
    }

  } catch (error) {
    console.error('Error stopping recording:', error);
    await interaction.editReply({ content: '❌ Failed to save recording: ' + error.message });
  }
}

// Register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('criar-sala')
      .setDescription('Create a temporary voice channel for recording')
      .addStringOption(option =>
        option.setName('nome')
          .setDescription('Name for the voice channel')
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('record')
      .setDescription('Start recording the current voice channel'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop recording and save the audio'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Check recording status')
  ].map(command => command.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Create temporary voice channel
async function createTemporaryChannel(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  
  if (!guild) {
    await interaction.reply({ content: '❌ This command can only be used in a server!', ephemeral: true });
    return;
  }

  // Check bot permissions
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ 
      content: '❌ **Missing Permission!**\n\n' +
               'I need the **"Manage Channels"** permission to create voice channels.\n\n' +
               '**How to fix:**\n' +
               '1. Go to Server Settings → Roles\n' +
               '2. Find my role and enable "Manage Channels"\n' +
               '3. Try again!',
      ephemeral: true 
    });
    return;
  }

  const channelName = interaction.options.getString('nome') || `${member.user.username}'s Room`;
  const fullChannelName = `${CONFIG.TEMP_CHANNEL_PREFIX} ${channelName}`;

  await interaction.deferReply({ ephemeral: true });

  try {
    // Find a category to create the channel in (optional - uses same category as text channel if possible)
    const parentCategory = interaction.channel?.parent;

    const voiceChannel = await guild.channels.create({
      name: fullChannelName,
      type: ChannelType.GuildVoice,
      parent: parentCategory?.id,
      reason: `Temporary recording channel created by ${member.user.tag}`,
      userLimit: 10
    });

    // Track the temporary channel
    temporaryChannels.set(voiceChannel.id, {
      creatorId: member.user.id,
      createdAt: Date.now(),
      guildId: guild.id
    });

    console.log(`🎙️ Created temporary channel: ${voiceChannel.name} (${voiceChannel.id})`);

    await interaction.editReply({
      content: `✅ **Sala criada!**\n\n` +
               `🎙️ **Canal:** ${voiceChannel.name}\n` +
               `👤 **Criador:** ${member.user.tag}\n\n` +
               `Entre na sala e convide outros participantes.\n` +
               `A sala será deletada automaticamente quando esvaziar.`
    });

    // Move user to the channel if they're in a voice channel
    if (member.voice.channel) {
      try {
        await member.voice.setChannel(voiceChannel);
      } catch (moveError) {
        console.warn('Could not move user to new channel:', moveError.message);
      }
    }

  } catch (error) {
    console.error('Error creating temporary channel:', error);
    await interaction.editReply({ content: '❌ Failed to create voice channel: ' + error.message });
  }
}

// Delete temporary channel
async function deleteTemporaryChannel(channelId) {
  const channelData = temporaryChannels.get(channelId);
  if (!channelData) return;

  try {
    const guild = client.guilds.cache.get(channelData.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      temporaryChannels.delete(channelId);
      return;
    }

    // Stop any active recording first
    if (activeRecordings.has(channelId)) {
      const recording = activeRecordings.get(channelId);
      recording.connection.destroy();
      activeRecordings.delete(channelId);
      console.log(`⏹️ Stopped recording in temporary channel: ${channel.name}`);
    }

    await channel.delete('Temporary recording channel - empty');
    temporaryChannels.delete(channelId);
    console.log(`🗑️ Deleted temporary channel: ${channel.name} (${channelId})`);

  } catch (error) {
    console.error('Error deleting temporary channel:', error);
    temporaryChannels.delete(channelId);
  }
}

// Handle voice state updates (for auto-delete when empty)
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Check if someone left a voice channel
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const leftChannelId = oldState.channelId;
    
    // Is this a temporary channel?
    if (temporaryChannels.has(leftChannelId)) {
      const channel = oldState.guild.channels.cache.get(leftChannelId);
      
      if (channel) {
        // Count members (excluding bots)
        const humanMembers = channel.members.filter(m => !m.user.bot).size;
        
        console.log(`👤 User left temporary channel ${channel.name}, ${humanMembers} humans remaining`);
        
        if (humanMembers === 0) {
          // Give a small delay before deleting (in case someone rejoins quickly)
          setTimeout(async () => {
            const currentChannel = oldState.guild.channels.cache.get(leftChannelId);
            if (currentChannel) {
              const currentHumans = currentChannel.members.filter(m => !m.user.bot).size;
              if (currentHumans === 0) {
                await deleteTemporaryChannel(leftChannelId);
              }
            }
          }, 3000); // 3 second grace period
        }
      }
    }
  }
});

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'criar-sala':
      await createTemporaryChannel(interaction);
      break;
    case 'record':
      await startRecording(interaction);
      break;
    case 'stop':
      await stopRecording(interaction);
      break;
    case 'status':
      const channel = interaction.member.voice.channel;
      if (channel && activeRecordings.has(channel.id)) {
        const recording = activeRecordings.get(channel.id);
        const duration = (Date.now() - recording.startTime.getTime()) / 1000;
        await interaction.reply({
          content: `🔴 **Recording in progress**\n` +
                   `⏱️ Duration: ${duration.toFixed(0)} seconds\n` +
                   `📍 Channel: ${channel.name}`,
          ephemeral: true
        });
      } else {
        await interaction.reply({ content: '⚪ No active recording', ephemeral: true });
      }
      break;
  }
});

// Bot ready
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`📊 Audio config: ${CONFIG.SAMPLE_RATE}Hz, ${CONFIG.BIT_DEPTH}-bit, ${CONFIG.CHANNELS} channels`);
  console.log(`🎙️ Temp channel prefix: "${CONFIG.TEMP_CHANNEL_PREFIX}"`);
  await registerCommands();
});

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN);
