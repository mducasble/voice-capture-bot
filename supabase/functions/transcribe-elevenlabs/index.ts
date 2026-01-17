import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Max file size for ElevenLabs (25MB for scribe_v2)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, mode = 'chunks' } = await req.json();
    // mode: 'chunks' = process all chunks, 'full' = send full WAV file

    if (!recording_id) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'ElevenLabs API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get recording details
    const { data: recording, error: fetchError } = await supabase
      .from('voice_recordings')
      .select('*')
      .eq('id', recording_id)
      .single();

    if (fetchError || !recording) {
      return new Response(
        JSON.stringify({ error: 'Recording not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to processing
    await supabase.from('voice_recordings').update({ 
      transcription_elevenlabs_status: 'processing' 
    }).eq('id', recording_id);

    console.log(`Starting ElevenLabs transcription for ${recording_id}, mode: ${mode}`);

    let fullTranscription = '';

    if (mode === 'full') {
      // Mode: Send full WAV file
      const audioUrl = recording.file_url;
      if (!audioUrl) {
        throw new Error('No WAV file available');
      }

      console.log(`Downloading full WAV: ${audioUrl}`);
      const audioResp = await fetch(audioUrl);
      if (!audioResp.ok) {
        throw new Error('Failed to download audio');
      }

      const audioBlob = await audioResp.blob();
      console.log(`Full WAV size: ${audioBlob.size} bytes`);

      if (audioBlob.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(audioBlob.size / 1024 / 1024).toFixed(1)}MB). Max is 25MB.`);
      }

      fullTranscription = await transcribeWithElevenLabs(audioBlob, 'audio.wav', 'audio/wav', ELEVENLABS_API_KEY, recording.language);
    } else {
      // Mode: Process all chunks
      const { data: files, error: listError } = await supabase.storage
        .from('voice-recordings')
        .list('chunks', {
          search: recording_id
        });

      if (listError) {
        throw new Error(`Failed to list chunks: ${listError.message}`);
      }

      // Filter and sort chunks by index
      const chunkFiles = (files || [])
        .filter(f => f.name.includes(recording_id) && f.name.includes('_chunk'))
        .sort((a, b) => {
          const indexA = parseInt(a.name.match(/chunk(\d+)/)?.[1] || '0');
          const indexB = parseInt(b.name.match(/chunk(\d+)/)?.[1] || '0');
          return indexA - indexB;
        });

      console.log(`Found ${chunkFiles.length} chunks to transcribe`);

      if (chunkFiles.length === 0) {
        // Fallback to MP3 or WAV file
        const audioUrl = recording.mp3_file_url || recording.file_url;
        if (!audioUrl) {
          throw new Error('No audio available');
        }

        console.log(`No chunks found, using: ${audioUrl}`);
        const audioResp = await fetch(audioUrl);
        const audioBlob = await audioResp.blob();
        const isMP3 = audioUrl.includes('.mp3');
        fullTranscription = await transcribeWithElevenLabs(
          audioBlob, 
          isMP3 ? 'audio.mp3' : 'audio.wav', 
          isMP3 ? 'audio/mpeg' : 'audio/wav', 
          ELEVENLABS_API_KEY, 
          recording.language
        );
      } else {
        // Process each chunk
        const transcriptions: string[] = [];
        
        for (let i = 0; i < chunkFiles.length; i++) {
          const chunk = chunkFiles[i];
          const chunkUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/voice-recordings/chunks/${chunk.name}`;
          
          console.log(`Processing chunk ${i + 1}/${chunkFiles.length}: ${chunk.name}`);
          
          try {
            const audioResp = await fetch(chunkUrl);
            if (!audioResp.ok) {
              console.error(`Failed to download chunk ${chunk.name}`);
              continue;
            }

            const audioBlob = await audioResp.blob();
            const chunkTranscription = await transcribeWithElevenLabs(
              audioBlob, 
              'chunk.wav', 
              'audio/wav', 
              ELEVENLABS_API_KEY, 
              recording.language
            );

            if (chunkTranscription) {
              transcriptions.push(chunkTranscription);
            }

            // Save progress every 5 chunks
            if ((i + 1) % 5 === 0 || i === chunkFiles.length - 1) {
              const progressText = transcriptions.join(' ');
              await supabase.from('voice_recordings').update({
                transcription_elevenlabs: progressText
              }).eq('id', recording_id);
              console.log(`Saved progress: ${transcriptions.length} chunks transcribed`);
            }
          } catch (chunkError) {
            console.error(`Error transcribing chunk ${chunk.name}:`, chunkError);
          }
        }

        fullTranscription = transcriptions.join(' ');
      }
    }

    console.log(`Transcription complete: ${fullTranscription.length} chars`);

    // Update database with final transcription
    await supabase.from('voice_recordings').update({ 
      transcription_elevenlabs: fullTranscription,
      transcription_elevenlabs_status: 'completed'
    }).eq('id', recording_id);

    return new Response(JSON.stringify({ 
      success: true, 
      recording_id, 
      transcription: fullTranscription,
      mode
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    
    // Try to update status to failed
    try {
      const { recording_id } = await req.clone().json();
      if (recording_id) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        await supabase.from('voice_recordings').update({
          transcription_elevenlabs_status: 'failed'
        }).eq('id', recording_id);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: 'Transcription failed', details: String(error) }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function transcribeWithElevenLabs(
  audioBlob: Blob, 
  filename: string, 
  mimeType: string, 
  apiKey: string,
  language?: string
): Promise<string> {
  const formData = new FormData();
  formData.append('file', new Blob([audioBlob], { type: mimeType }), filename);
  formData.append('model_id', 'scribe_v2');
  
  // Map language codes if provided
  if (language) {
    const langMap: Record<string, string> = {
      'pt': 'por', 'en': 'eng', 'es': 'spa', 'fr': 'fra',
      'de': 'deu', 'it': 'ita', 'ja': 'jpn', 'ko': 'kor',
      'zh': 'zho', 'ru': 'rus',
    };
    const langCode = langMap[language.toLowerCase()] || language;
    formData.append('language_code', langCode);
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs API error:', response.status, errText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const result = await response.json();
  return result.text || '';
}
