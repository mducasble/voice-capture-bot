import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AudioMetricsEstimate {
  srmr: number | null;
  sigmos_disc: number | null;
  sigmos_ovrl: number | null;
  sigmos_reverb: number | null;
  vqscore: number | null;
  wvmos: number | null;
  reasoning: string;
}

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
    console.log(`Estimating advanced metrics for recording ${recording_id}`);
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

    // Call Lovable AI to estimate advanced metrics
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
            content: `You are an advanced audio quality assessment specialist with expertise in audio metrics. Analyze the provided audio and estimate these metrics:

**SRMR** (Speech-to-Reverberation Modulation Ratio): Score 0-40+ dB
- Measures reverberation/echo intensity
- Higher is better (less reverb)
- ~20+ dB = good acoustic conditions

**SigMOS** - Speech Intelligibility and Distortion MOS
- **DISC** (Distortion): 1.0-5.0 scale
  - 5.0 = No distortion
  - 1.0 = Severe distortion
- **OVRL** (Overall Quality): 1.0-5.0 scale
  - 5.0 = Excellent quality
  - 1.0 = Very poor quality
- **REVERB** (Reverberation): 1.0-5.0 scale
  - 5.0 = No reverberation
  - 1.0 = Severe reverberation

**VQScore** (Voice Quality Score): 0.0-100.0
- Comprehensive quality metric
- Considers speech clarity, noise, distortion
- >80 = Excellent, 60-80 = Good, <60 = Poor

**WVMOS** (Weighted Voice MOS): 1.0-5.0
- Perceptual quality rating with focus on intelligibility
- 5.0 = Excellent (clear, natural, no artifacts)
- 3.0 = Fair (some issues but acceptable)
- 1.0 = Bad (unintelligible)

Additional context (may help estimate):
- SNR: ${snr_db || 'unknown'} dB
- RMS Level: ${rms_dbfs || 'unknown'} dBFS

Respond ONLY with a JSON object:
{
  "srmr": <number or null>,
  "sigmos_disc": <1.0-5.0 or null>,
  "sigmos_ovrl": <1.0-5.0 or null>,
  "sigmos_reverb": <1.0-5.0 or null>,
  "vqscore": <0.0-100.0 or null>,
  "wvmos": <1.0-5.0 or null>,
  "reasoning": "<brief explanation of all estimates>"
}

If you cannot reliably estimate a metric, use null for that field.`
          },
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: 'Analyze this audio and estimate all advanced quality metrics. Provide your best estimates based on perceptual analysis.'
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
          JSON.stringify({ error: 'Insufficient credits for metric estimation' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || '';

    // Parse metrics from response
    let metrics: AudioMetricsEstimate = {
      srmr: null,
      sigmos_disc: null,
      sigmos_ovrl: null,
      sigmos_reverb: null,
      vqscore: null,
      wvmos: null,
      reasoning: ''
    };
    
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Extract and validate metrics
        if (typeof parsed?.srmr === 'number') {
          metrics.srmr = Math.max(0, parsed.srmr); // SRMR should be >= 0
        }
        if (typeof parsed?.sigmos_disc === 'number') {
          metrics.sigmos_disc = Math.max(1.0, Math.min(5.0, parsed.sigmos_disc));
        }
        if (typeof parsed?.sigmos_ovrl === 'number') {
          metrics.sigmos_ovrl = Math.max(1.0, Math.min(5.0, parsed.sigmos_ovrl));
        }
        if (typeof parsed?.sigmos_reverb === 'number') {
          metrics.sigmos_reverb = Math.max(1.0, Math.min(5.0, parsed.sigmos_reverb));
        }
        if (typeof parsed?.vqscore === 'number') {
          metrics.vqscore = Math.max(0, Math.min(100, parsed.vqscore));
        }
        if (typeof parsed?.wvmos === 'number') {
          metrics.wvmos = Math.max(1.0, Math.min(5.0, parsed.wvmos));
        }
        metrics.reasoning = parsed?.reasoning || '';
      }
    } catch (e) {
      console.warn('Failed to parse metrics response:', e);
    }

    // Validate that at least one metric was extracted
    const hasMetrics = metrics.srmr !== null || metrics.sigmos_disc !== null || 
                      metrics.sigmos_ovrl !== null || metrics.sigmos_reverb !== null || 
                      metrics.vqscore !== null || metrics.wvmos !== null;

    if (!hasMetrics) {
      console.warn('Could not extract any valid metrics from AI response');
      return new Response(
        JSON.stringify({ error: 'Failed to estimate audio metrics' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update recording with metrics
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
      srmr: metrics.srmr,
      sigmos_disc: metrics.sigmos_disc,
      sigmos_ovrl: metrics.sigmos_ovrl,
      sigmos_reverb: metrics.sigmos_reverb,
      vqscore: metrics.vqscore,
      wvmos: metrics.wvmos,
      metrics_reasoning: metrics.reasoning,
      metrics_estimated_at: new Date().toISOString()
    };

    await supabase
      .from('voice_recordings')
      .update({ metadata })
      .eq('id', recording_id);

    console.log(`Metrics estimation complete for recording ${recording_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        recording_id,
        metrics
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Metrics estimation failed' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
