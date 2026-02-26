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
    // Validate bot API key
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

    // Fetch active campaigns
    const { data: campaigns, error: campError } = await supabase
      .from("campaigns")
      .select(`
        *,
        client:clients(*)
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (campError) throw campError;

    // Enrich each campaign with languages, regions, sections
    const enriched = await Promise.all(
      (campaigns || []).map(async (c: any) => {
        const [langRes, regRes, secRes] = await Promise.all([
          supabase
            .from("campaign_languages")
            .select("language:languages(*)")
            .eq("campaign_id", c.id),
          supabase
            .from("campaign_regions")
            .select("region:regions(*)")
            .eq("campaign_id", c.id),
          supabase
            .from("campaign_sections")
            .select("*")
            .eq("campaign_id", c.id)
            .eq("is_active", true)
            .order("sort_order"),
        ]);

        return {
          ...c,
          languages: langRes.data?.map((l: any) => l.language) || [],
          regions: regRes.data?.map((r: any) => r.region) || [],
          sections: secRes.data || [],
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
