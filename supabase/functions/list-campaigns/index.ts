import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bot-api-key",
};

const CATEGORY_MAP: Record<string, string> = {
  audio_capture_solo: "audio",
  audio_capture_group: "audio",
  image_submission: "image",
  video_submission: "video",
  data_labeling: "annotation",
  transcription: "text",
  prompt_review: "review",
  image_review: "review",
};

const CATEGORY_TABLE: Record<string, string> = {
  image: "campaign_image_validation",
  video: "campaign_video_validation",
  annotation: "campaign_annotation_validation",
  text: "campaign_text_validation",
  review: "campaign_review_validation",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botApiKey = req.headers.get("x-bot-api-key");
    const expectedApiKey = Deno.env.get("BOT_API_KEY");

    if (!botApiKey || botApiKey !== expectedApiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: campaigns, error: campError } = await supabase
      .from("campaigns")
      .select(`*, client:clients(*)`)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (campError) throw campError;

    const enriched = await Promise.all(
      (campaigns || []).map(async (c: any) => {
        const [geoRes, langRes, taskSetsRes, rewardRes, qualityRes, instructionsRes] = await Promise.all([
          supabase.from("campaign_geographic_scope").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_language_variants").select("*").eq("campaign_id", c.id),
          supabase.from("campaign_task_sets").select("*").eq("campaign_id", c.id).order("weight"),
          supabase.from("campaign_reward_config").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_quality_flow").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_instructions").select("*").eq("campaign_id", c.id).maybeSingle(),
        ]);

        // Enrich task sets with validation
        const taskSets = await Promise.all(
          (taskSetsRes.data || []).map(async (ts: any) => {
            const category = CATEGORY_MAP[ts.task_type] || "audio";
            let tech: any[] = [];
            let content: any[] = [];

            if (category === "audio") {
              const [audioRes, contentRes] = await Promise.all([
                supabase.from("campaign_audio_validation").select("*").eq("task_set_id", ts.id),
                supabase.from("campaign_content_validation").select("*").eq("task_set_id", ts.id),
              ]);
              tech = audioRes.data || [];
              content = contentRes.data || [];
            } else {
              const table = CATEGORY_TABLE[category];
              if (table) {
                const { data } = await supabase.from(table).select("*").eq("task_set_id", ts.id);
                const rows = data || [];
                tech = rows.filter((r: any) => r.validation_scope === "technical");
                content = rows.filter((r: any) => r.validation_scope === "content");
              }
            }

            return { ...ts, tech_validation: tech, content_validation: content };
          })
        );

        return {
          ...c,
          geographic_scope: geoRes.data || null,
          language_variants: langRes.data || [],
          task_sets: taskSets,
          reward_config: rewardRes.data || null,
          quality_flow: qualityRes.data || null,
          instructions: instructionsRes.data || null,
        };
      })
    );

    return new Response(JSON.stringify({ campaigns: enriched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
