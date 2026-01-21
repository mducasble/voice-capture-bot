import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IndividualRecording {
  id: string;
  discord_username: string | null;
  discord_user_id: string;
  transcription: string | null;
  transcription_status: string | null;
  duration_seconds: number | null;
  created_at: string;
}

interface SpeakerSegment {
  speaker: string;
  text: string;
  startTime: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const session_id: string | undefined = body?.session_id;
    const mixed_recording_id: string | undefined = body?.mixed_recording_id;

    if (!session_id && !mixed_recording_id) {
      return json({ error: "Missing session_id or mixed_recording_id" }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let targetSessionId = session_id;

    // If mixed_recording_id provided, get session_id from it
    if (!targetSessionId && mixed_recording_id) {
      const { data: mixedRec } = await supabase
        .from('voice_recordings')
        .select('session_id')
        .eq('id', mixed_recording_id)
        .single();

      if (!mixedRec?.session_id) {
        return json({ error: "No session_id found for this recording" }, 404);
      }
      targetSessionId = mixedRec.session_id;
    }

    console.log(`Aggregating session transcriptions for session: ${targetSessionId}`);

    // Fetch all individual recordings for this session
    const { data: individualRecordings, error: fetchError } = await supabase
      .from('voice_recordings')
      .select('id, discord_username, discord_user_id, transcription, transcription_status, duration_seconds, created_at')
      .eq('session_id', targetSessionId)
      .eq('recording_type', 'individual')
      .order('discord_user_id');

    if (fetchError) {
      console.error('Failed to fetch individual recordings:', fetchError);
      return json({ error: "Failed to fetch recordings" }, 500);
    }

    if (!individualRecordings || individualRecordings.length === 0) {
      return json({ 
        success: false, 
        error: "no_individual_tracks",
        message: "Não foram encontradas faixas individuais para esta sessão." 
      }, 200);
    }

    console.log(`Found ${individualRecordings.length} individual recordings`);

    // Check transcription status of individual tracks
    const pendingCount = individualRecordings.filter(r => 
      r.transcription_status === 'pending' || r.transcription_status === 'processing'
    ).length;

    const failedCount = individualRecordings.filter(r => 
      r.transcription_status === 'failed'
    ).length;

    const completedCount = individualRecordings.filter(r => 
      r.transcription_status === 'completed' && r.transcription
    ).length;

    if (pendingCount > 0) {
      return json({
        success: false,
        status: "waiting",
        message: `Aguardando transcrição de ${pendingCount} faixas individuais.`,
        stats: { pending: pendingCount, completed: completedCount, failed: failedCount }
      }, 200);
    }

    // Build speaker-identified transcription
    const speakerTranscriptions: { speaker: string; userId: string; text: string }[] = [];

    for (const rec of individualRecordings) {
      if (rec.transcription && rec.transcription.trim()) {
        const speaker = rec.discord_username || `User_${rec.discord_user_id.slice(-4)}`;
        speakerTranscriptions.push({
          speaker,
          userId: rec.discord_user_id,
          text: rec.transcription.trim()
        });
      }
    }

    if (speakerTranscriptions.length === 0) {
      return json({
        success: false,
        error: "no_transcriptions",
        message: "Nenhuma faixa individual possui transcrição.",
        stats: { pending: pendingCount, completed: completedCount, failed: failedCount }
      }, 200);
    }

    // Format as conversation with speaker labels
    const formattedParts: string[] = [];
    
    for (const st of speakerTranscriptions) {
      formattedParts.push(`[${st.speaker}]:\n${st.text}`);
    }

    const aggregatedTranscription = formattedParts.join('\n\n---\n\n');

    // Build metadata about speakers
    const speakerMeta = speakerTranscriptions.map(st => ({
      username: st.speaker,
      user_id: st.userId,
      has_transcription: true
    }));

    // Update mixed recording with aggregated transcription if mixed_recording_id provided
    if (mixed_recording_id) {
      const { error: updateError } = await supabase
        .from('voice_recordings')
        .update({
          metadata: {
            speaker_transcription: aggregatedTranscription,
            speakers: speakerMeta,
            aggregated_at: new Date().toISOString()
          }
        })
        .eq('id', mixed_recording_id);

      if (updateError) {
        console.error('Failed to update mixed recording:', updateError);
      } else {
        console.log(`Saved speaker transcription to mixed recording ${mixed_recording_id}`);
      }
    }

    return json({
      success: true,
      session_id: targetSessionId,
      speakers: speakerMeta,
      transcription: aggregatedTranscription,
      stats: {
        total_tracks: individualRecordings.length,
        transcribed: speakerTranscriptions.length,
        failed: failedCount
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return json({ error: "Failed to aggregate transcriptions", details: String(error) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
