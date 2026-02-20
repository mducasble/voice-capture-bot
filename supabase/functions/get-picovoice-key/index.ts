import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const accessKey = Deno.env.get("PICOVOICE_ACCESS_KEY");
  if (!accessKey) {
    return new Response(
      JSON.stringify({ error: "PICOVOICE_ACCESS_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ accessKey }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
