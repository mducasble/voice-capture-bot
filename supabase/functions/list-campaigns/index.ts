import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bot-api-key",
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
        const [geoRes, langRes, taskRes, adminRes, audioRes, contentRes, rewardRes, qualityRes] = await Promise.all([
          supabase.from("campaign_geographic_scope").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_language_variants").select("*").eq("campaign_id", c.id),
          supabase.from("campaign_task_config").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_administrative_rules").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_audio_validation").select("*").eq("campaign_id", c.id),
          supabase.from("campaign_content_validation").select("*").eq("campaign_id", c.id),
          supabase.from("campaign_reward_config").select("*").eq("campaign_id", c.id).maybeSingle(),
          supabase.from("campaign_quality_flow").select("*").eq("campaign_id", c.id).maybeSingle(),
        ]);

        return {
          ...c,
          geographic_scope: geoRes.data || null,
          language_variants: langRes.data || [],
          task_config: taskRes.data || null,
          administrative_rules: adminRes.data || null,
          audio_validation: audioRes.data || [],
          content_validation: contentRes.data || [],
          reward_config: rewardRes.data || null,
          quality_flow: qualityRes.data || null,
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
