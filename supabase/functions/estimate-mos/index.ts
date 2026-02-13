import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, file_url, snr_db, rms_dbfs } = await req.json();

    if (!recording_id || !file_url) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id or file_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download audio file
    console.log(`Estimating MOS for recording ${recording_id}`);
    const audioResp = await fetch(file_url);
    if (!audioResp.ok) {
      throw new Error(`Failed to download audio: ${audioResp.status}`);
    }

    const audioBuffer = await audioResp.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);
    
    // Detect format from URL or content
    const isMP3 = file_url.toLowerCase().includes('.mp3');
    const audioFormat = isMP3 ? 'mp3' : 'wav';
    
    const base64Audio = encode(audioBytes.buffer);

    // Call Lovable AI to estimate MOS score
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are an audio quality assessment specialist. Analyze the provided audio and estimate its Mean Opinion Score (MOS) on a scale of 1.0 to 5.0:
- 5.0 = Excellent (crystal clear, no noise)
- 4.0 = Good (mostly clear with minimal noise)
- 3.0 = Fair (some noise but intelligible)
- 2.0 = Poor (significant noise, difficult to understand)
- 1.0 = Bad (unintelligible)

Consider these factors:
1. Background noise level and type
2. Speech clarity and intelligibility
3. Audio distortion or artifacts
4. Overall listening experience

You will also receive SNR (Signal-to-Noise Ratio) and RMS (loudness) metrics that may help inform your estimate.

Respond ONLY with a JSON object: {"mos_score": <number between 1.0 and 5.0>, "reasoning": "<brief explanation>"}`
          },
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: `Analyze this audio and estimate its MOS score. SNR: ${snr_db || 'unknown'}dB, RMS: ${rms_dbfs || 'unknown'}dBFS`
              },
              { 
                type: 'input_audio', 
                input_audio: { data: base64Audio, format: audioFormat } 
              }
            ]
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI gateway error:', aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded, try again later' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Insufficient credits for MOS estimation' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || '';

    // Parse MOS score from response
    let mosScore: number | null = null;
    let reasoning = '';
    
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        mosScore = typeof parsed?.mos_score === 'number' ? parsed.mos_score : null;
        reasoning = parsed?.reasoning || '';
        
        // Ensure MOS is within valid range
        if (mosScore !== null) {
          mosScore = Math.max(1.0, Math.min(5.0, mosScore));
        }
      }
    } catch (e) {
      console.warn('Failed to parse MOS response:', e);
    }

    if (mosScore === null) {
      console.warn('Could not extract MOS score from AI response');
      return new Response(
        JSON.stringify({ error: 'Failed to estimate MOS score' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update recording with MOS score
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: recording } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', recording_id)
      .single();

    const metadata = {
      ...(recording?.metadata || {}),
      mos_score: mosScore,
      mos_reasoning: reasoning,
      mos_estimated_at: new Date().toISOString()
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);

    console.log(`MOS estimation complete: ${mosScore.toFixed(2)}`);

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        mos_score: mosScore,
        reasoning
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'MOS estimation failed' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
