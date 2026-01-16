import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } from 'discord.js';
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
import 'dotenv/config';

// Configuration
const CONFIG = {
  SAMPLE_RATE: 44100,
  BIT_DEPTH: 16,
  CHANNELS: 2,
  RECORDINGS_DIR: './recordings'
};

// Create recordings directory
if (!existsSync(CONFIG.RECORDINGS_DIR)) {
  mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// Active recordings map
const activeRecordings = new Map();

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
class AudioMixer {
  constructor() {
    this.streams = new Map();
    this.buffer = [];
    this.startTime = Date.now();
  }

  addStream(userId, stream) {
    this.streams.set(userId, { stream, chunks: [] });
  }

  removeStream(userId) {
    this.streams.delete(userId);
  }

  addChunk(userId, chunk) {
    if (this.streams.has(userId)) {
      this.streams.get(userId).chunks.push({
        timestamp: Date.now() - this.startTime,
        data: chunk
      });
    }
  }

  getMixedAudio() {
    // Collect all chunks and mix them
    const allChunks = [];
    
    for (const [userId, { chunks }] of this.streams) {
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
      // Skip if already tracking this user
      if (mixer.streams.has(userId)) return;
      
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
    await interaction.editReply({ content: '❌ Failed to start recording: ' + error.message });
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

    const response = await fetch(`${process.env.LOVABLE_API_URL}/upload-recording`, {
      method: 'POST',
      headers: {
        'x-bot-api-key': process.env.BOT_API_KEY
      },
      body: formData
    });

    const result = await response.json();

    // Clean up local file
    unlinkSync(filepath);

    if (response.ok) {
      await interaction.editReply({
        content: `✅ **Recording saved!**\n\n` +
                 `📁 **File:** ${filename}\n` +
                 `⏱️ **Duration:** ${duration.toFixed(1)} seconds\n` +
                 `📊 **Size:** ${(wavBuffer.length / 1024 / 1024).toFixed(2)} MB\n` +
                 `🔗 **URL:** ${result.file_url}\n\n` +
                 `Audio recorded at 44.1kHz, 16-bit, stereo WAV`
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

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
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
  await registerCommands();
});

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN);
