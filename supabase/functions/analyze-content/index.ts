import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id } = await req.json();
    if (!recording_id) {
      return new Response(
        JSON.stringify({ error: "Missing recording_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch recording with transcription
    const { data: recording, error: fetchError } = await supabase
      .from("voice_recordings")
      .select("id, transcription, session_id, campaign_id, metadata, recording_type")
      .eq("id", recording_id)
      .single();

    if (fetchError || !recording) {
      console.error("Recording not found:", fetchError);
      return new Response(
        JSON.stringify({ error: "Recording not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcription = recording.transcription;
    if (!transcription || transcription.trim().length < 20) {
      console.log("Transcription too short or missing, skipping analysis");
      return new Response(
        JSON.stringify({ success: true, message: "Skipped: no transcription" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the topic from the room
    let topic: string | null = null;
    if (recording.session_id) {
      const { data: room } = await supabase
        .from("rooms")
        .select("topic")
        .eq("session_id", recording.session_id)
        .maybeSingle();
      topic = room?.topic || null;
    }

    // For the session, also fetch individual recordings to analyze speaker time
    let speakerTranscriptions: { speaker: string; transcription: string; durationSeconds: number | null }[] = [];
    if (recording.recording_type === "mixed" && recording.session_id) {
      const { data: sessionRecs } = await supabase
        .from("voice_recordings")
        .select("id, discord_username, user_id, transcription, duration_seconds, recording_type")
        .eq("session_id", recording.session_id)
        .neq("recording_type", "mixed");

      if (sessionRecs && sessionRecs.length > 0) {
        // Fetch profile names for user_ids
        const userIds = sessionRecs.map(r => r.user_id).filter(Boolean);
        const { data: profiles } = userIds.length > 0
          ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
          : { data: [] };
        const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));

        speakerTranscriptions = sessionRecs.map(r => ({
          speaker: (r.user_id ? profileMap.get(r.user_id) : null) || r.discord_username || "Participante",
          transcription: r.transcription || "",
          durationSeconds: r.duration_seconds,
        }));
      }
    }

    // Build prompt
    const topicInstruction = topic
      ? `O tema proposto para esta conversa foi: "${topic}".`
      : "Não há um tema específico definido. Analise o conteúdo geral.";

    const speakerSection = speakerTranscriptions.length > 0
      ? `\n\nTranscrições individuais por participante:\n${speakerTranscriptions.map((s, i) =>
          `--- ${s.speaker} (duração: ${s.durationSeconds ? Math.round(s.durationSeconds) + "s" : "N/A"}) ---\n${s.transcription || "(sem transcrição)"}`
        ).join("\n\n")}`
      : "";

    const prompt = `Analise a seguinte transcrição de uma conversa gravada.

${topicInstruction}

Transcrição principal (áudio combinado):
${transcription.slice(0, 8000)}
${speakerSection}

Retorne APENAS um JSON com esta estrutura exata:
{
  "topic_adherence_percent": <número de 0 a 100 representando % do conteúdo que está no tema>,
  "off_topic_summary": "<breve descrição dos desvios de tema, se houver>",
  "speakers": [
    {
      "name": "<nome do participante>",
      "speaking_time_percent": <% estimado do tempo total de fala>,
      "on_topic_percent": <% do conteúdo deste participante que está no tema>
    }
  ],
  "content_summary": "<resumo de 1-2 frases do conteúdo da conversa>"
}

Regras:
- Se não há tema definido, avalie coerência geral e retorne topic_adherence_percent como a % de conteúdo coerente/produtivo
- speaking_time_percent deve somar 100% entre todos os participantes
- Se não há transcrições individuais, retorne speakers como array vazio
- Seja conservador: trechos de cumprimentos, transições naturais e comentários curtos relacionados ao contexto da conversa contam como "no tema"`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "You are a content analysis tool. Respond ONLY with valid JSON, no markdown, no extra text.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON
    let analysis: any = null;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse AI JSON:", e, rawContent.slice(0, 500));
    }

    if (!analysis) {
      return new Response(JSON.stringify({ error: "Failed to parse analysis" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Merge into recording metadata
    const currentMetadata = recording.metadata || {};
    const mergedMetadata = {
      ...currentMetadata,
      content_analysis: {
        topic_adherence_percent: analysis.topic_adherence_percent,
        off_topic_summary: analysis.off_topic_summary || null,
        speakers: analysis.speakers || [],
        content_summary: analysis.content_summary || null,
        analyzed_at: new Date().toISOString(),
        topic_used: topic || null,
      },
    };

    await supabase
      .from("voice_recordings")
      .update({ metadata: mergedMetadata })
      .eq("id", recording_id);

    console.log(
      `Content analysis complete for ${recording_id}: ${analysis.topic_adherence_percent}% on-topic, ${(analysis.speakers || []).length} speakers`
    );

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
