import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert audio file to base64
async function audioToBase64(audioUrl: string): Promise<string> {
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Convert to base64
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

serve(async (req) => {
  // Handle CORS preflight
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
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Transcription service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update status to processing
    await supabase
      .from('voice_recordings')
      .update({ transcription_status: 'processing' })
      .eq('id', recording_id);

    console.log(`Starting transcription for recording ${recording_id}`);

    // Get audio as base64
    const audioBase64 = await audioToBase64(audio_url);
    console.log(`Audio converted to base64, size: ${audioBase64.length} chars`);

    // Determine language instruction
    const languageInstruction = language && language !== 'en' 
      ? `The audio is in ${language}. Transcribe it in the original language.`
      : 'Transcribe the audio in the language being spoken.';

    // Call Lovable AI Gateway with Gemini for transcription
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are an expert audio transcription assistant. Your task is to accurately transcribe spoken audio content. ${languageInstruction}

Instructions:
- Transcribe exactly what is spoken, maintaining the original language
- Include punctuation and proper formatting
- If there are multiple speakers, try to indicate speaker changes with [Speaker 1], [Speaker 2], etc.
- If parts are unclear, mark them as [inaudible]
- Do not add commentary or interpretation, only transcribe the spoken words
- Return ONLY the transcription text, nothing else`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please transcribe this audio recording accurately:'
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format: 'wav'
                }
              }
            ]
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      // Handle rate limiting
      if (aiResponse.status === 429) {
        await supabase
          .from('voice_recordings')
          .update({ transcription_status: 'failed' })
          .eq('id', recording_id);
        
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (aiResponse.status === 402) {
        await supabase
          .from('voice_recordings')
          .update({ transcription_status: 'failed' })
          .eq('id', recording_id);
        
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('voice_recordings')
        .update({ transcription_status: 'failed' })
        .eq('id', recording_id);

      return new Response(
        JSON.stringify({ error: 'Transcription failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const transcription = aiData.choices?.[0]?.message?.content?.trim() || '';

    console.log(`Transcription completed for ${recording_id}, length: ${transcription.length} chars`);

    // Update the recording with transcription
    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({
        transcription: transcription,
        transcription_status: 'completed'
      })
      .eq('id', recording_id);

    if (updateError) {
      console.error('Failed to update recording with transcription:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transcription', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        transcription,
        status: 'completed'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Transcription error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Transcription failed', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
