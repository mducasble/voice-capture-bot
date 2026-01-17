import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, audio_url, language } = await req.json();

    if (!recording_id || !audio_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or audio_url' }),
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

    // Update status to processing
    await supabase.from('voice_recordings').update({ 
      transcription_status: 'processing' 
    }).eq('id', recording_id);

    console.log(`Starting ElevenLabs transcription for ${recording_id}`);

    // Download audio file
    console.log(`Downloading audio: ${audio_url}`);
    const audioResp = await fetch(audio_url);
    if (!audioResp.ok) {
      await supabase.from('voice_recordings').update({ 
        transcription_status: 'failed' 
      }).eq('id', recording_id);
      return new Response(
        JSON.stringify({ error: 'Failed to download audio' }), 
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBlob = await audioResp.blob();
    console.log(`Audio downloaded: ${audioBlob.size} bytes`);

    // Prepare form data for ElevenLabs
    const formData = new FormData();
    
    // Determine file extension from URL
    const isMP3 = audio_url.toLowerCase().includes('.mp3');
    const filename = isMP3 ? 'audio.mp3' : 'audio.wav';
    const mimeType = isMP3 ? 'audio/mpeg' : 'audio/wav';
    
    formData.append('file', new Blob([audioBlob], { type: mimeType }), filename);
    formData.append('model_id', 'scribe_v2');
    formData.append('tag_audio_events', 'true');
    formData.append('diarize', 'true');
    
    // Map language codes if provided
    if (language) {
      // ElevenLabs uses ISO 639-3 codes
      const langMap: Record<string, string> = {
        'pt': 'por',
        'en': 'eng',
        'es': 'spa',
        'fr': 'fra',
        'de': 'deu',
        'it': 'ita',
        'ja': 'jpn',
        'ko': 'kor',
        'zh': 'zho',
        'ru': 'rus',
      };
      const langCode = langMap[language.toLowerCase()] || language;
      formData.append('language_code', langCode);
    }

    console.log('Calling ElevenLabs Speech-to-Text API...');
    const elevenLabsResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: formData,
    });

    if (!elevenLabsResponse.ok) {
      const errText = await elevenLabsResponse.text();
      console.error('ElevenLabs API error:', elevenLabsResponse.status, errText);
      await supabase.from('voice_recordings').update({ 
        transcription_status: 'failed' 
      }).eq('id', recording_id);
      return new Response(
        JSON.stringify({ error: 'ElevenLabs transcription failed', details: errText }), 
        { status: elevenLabsResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await elevenLabsResponse.json();
    console.log('ElevenLabs response received');

    // Extract transcription text
    const transcription = result.text || '';
    
    // Build detailed transcription with speaker labels if available
    let detailedTranscription = transcription;
    if (result.words && result.words.length > 0) {
      // Group words by speaker if diarization is available
      const hasSpeakers = result.words.some((w: { speaker?: string }) => w.speaker);
      if (hasSpeakers) {
        let currentSpeaker = '';
        const segments: string[] = [];
        let currentSegment = '';
        
        for (const word of result.words) {
          if (word.speaker && word.speaker !== currentSpeaker) {
            if (currentSegment) {
              segments.push(`[${currentSpeaker}]: ${currentSegment.trim()}`);
            }
            currentSpeaker = word.speaker;
            currentSegment = word.text;
          } else {
            currentSegment += ' ' + word.text;
          }
        }
        if (currentSegment) {
          segments.push(`[${currentSpeaker}]: ${currentSegment.trim()}`);
        }
        detailedTranscription = segments.join('\n\n');
      }
    }

    // Add audio events if detected
    if (result.audio_events && result.audio_events.length > 0) {
      const events = result.audio_events.map((e: { type: string; start: number; end: number }) => 
        `[${e.type} at ${e.start.toFixed(1)}s-${e.end.toFixed(1)}s]`
      ).join(', ');
      detailedTranscription += `\n\n---\nAudio events: ${events}`;
    }

    console.log(`Transcription complete: ${detailedTranscription.length} chars`);

    // Update database
    await supabase.from('voice_recordings').update({ 
      transcription: detailedTranscription,
      transcription_status: 'completed'
    }).eq('id', recording_id);

    return new Response(JSON.stringify({ 
      success: true, 
      recording_id, 
      transcription: detailedTranscription,
      raw_result: result
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Transcription failed', details: String(error) }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
