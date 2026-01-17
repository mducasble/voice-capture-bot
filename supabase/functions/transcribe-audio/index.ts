import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Limit to 5MB to stay within edge function memory constraints
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Transcription service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase.from('voice_recordings').update({ transcription_status: 'processing' }).eq('id', recording_id);

    console.log(`Starting transcription for ${recording_id}`);

    const languageInstruction = language 
      ? `The audio is in ${language}. Transcribe it in that language.`
      : 'Automatically detect the language and transcribe in that language.';

    // Download audio with size limit
    console.log(`Downloading audio (max 5MB): ${audio_url}`);
    const audioResp = await fetch(audio_url);
    if (!audioResp.ok) {
      await supabase.from('voice_recordings').update({ transcription_status: 'failed' }).eq('id', recording_id);
      return new Response(JSON.stringify({ error: 'Failed to download audio' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const audioBuffer = await audioResp.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer.byteLength > MAX_AUDIO_BYTES ? audioBuffer.slice(0, MAX_AUDIO_BYTES) : audioBuffer);
    console.log(`Audio: ${audioBytes.length} bytes`);

    const base64Audio = encode(audioBytes);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: `You are an audio transcription assistant. ${languageInstruction}\n\nRespond ONLY with JSON: {"detected_language": "ISO code", "transcription": "text"}` },
          { role: 'user', content: [{ type: 'text', text: 'Transcribe this audio:' }, { type: 'input_audio', input_audio: { data: base64Audio, format: 'wav' } }] }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI error:', aiResponse.status, errText);
      await supabase.from('voice_recordings').update({ transcription_status: 'failed' }).eq('id', recording_id);
      return new Response(JSON.stringify({ error: 'Transcription failed', details: errText }), { status: aiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || '';

    let transcription = rawContent;
    let detectedLanguage: string | null = null;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        transcription = parsed.transcription || rawContent;
        detectedLanguage = parsed.detected_language || null;
      }
    } catch { /* use raw */ }

    console.log(`Transcription done: ${transcription.length} chars`);

    const updateData: Record<string, unknown> = { transcription, transcription_status: 'completed' };
    if (detectedLanguage && !language) updateData.language = detectedLanguage.toLowerCase();

    await supabase.from('voice_recordings').update(updateData).eq('id', recording_id);

    return new Response(JSON.stringify({ success: true, recording_id, transcription, detected_language: detectedLanguage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Transcription failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
