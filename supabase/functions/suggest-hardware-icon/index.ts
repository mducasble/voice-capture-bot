import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { name } = await req.json();
    if (!name || typeof name !== "string") {
      return new Response(JSON.stringify({ error: "Missing hardware name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedName = name.trim().toLowerCase();

    // Check cache first
    const { data: existing } = await supabase
      .from("hardware_catalog")
      .select("*")
      .ilike("name", normalizedName)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ hardware: existing }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ask AI for the best Lucide icon
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a helper that maps hardware/device names to Lucide React icon names. 
Given a hardware name, return the most appropriate lucide-react icon name in kebab-case format.
Common mappings:
- microphone, mic → "mic"
- headphones, headset, earbuds → "headphones"
- smartphone, phone, cellphone → "smartphone"
- computer, desktop, pc → "monitor"
- laptop, notebook → "laptop"
- tablet, ipad → "tablet"
- camera, webcam → "camera"
- speaker → "speaker"
- keyboard → "keyboard"
- mouse → "mouse"
- wifi, internet → "wifi"
- usb, cable → "usb"
- hard drive, storage → "hard-drive"
- printer → "printer"
- monitor, screen, display → "monitor"
- watch, smartwatch → "watch"
- gamepad, controller → "gamepad-2"
- router → "router"
- server → "server"
- battery → "battery"
- bluetooth → "bluetooth"
- gpu, graphics card → "cpu"
- processor, cpu → "cpu"
- ram, memory → "memory-stick"
- tripod → "triangle"
- ring light, light → "lamp"
- pop filter → "circle-dot"
- audio interface, sound card → "audio-lines"
If uncertain, use "settings" as fallback.`,
          },
          {
            role: "user",
            content: `Hardware: "${name}". Return only the icon name.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_icon",
              description: "Return the suggested Lucide icon name for the hardware",
              parameters: {
                type: "object",
                properties: {
                  icon_name: { type: "string", description: "The lucide-react icon name in kebab-case" },
                  display_name: { type: "string", description: "A clean, capitalized display name for the hardware" },
                },
                required: ["icon_name", "display_name"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_icon" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI suggestion failed");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const parsed = JSON.parse(toolCall.function.arguments);
    const iconName = parsed.icon_name || "settings";
    const displayName = parsed.display_name || name;

    // Cache in hardware_catalog
    const { data: inserted, error: insertError } = await supabase
      .from("hardware_catalog")
      .insert({ name: displayName, icon_name: iconName })
      .select()
      .single();

    if (insertError) {
      // Might be a race condition duplicate, try to fetch
      const { data: existing2 } = await supabase
        .from("hardware_catalog")
        .select("*")
        .ilike("name", normalizedName)
        .maybeSingle();
      if (existing2) {
        return new Response(JSON.stringify({ hardware: existing2 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw insertError;
    }

    return new Response(JSON.stringify({ hardware: inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
