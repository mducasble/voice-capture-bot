import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, language, country, city } = await req.json();
    if (!topic) {
      return new Response(JSON.stringify({ error: "topic is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Determine output language: prioritize country-based detection, fallback to UI language
    const countryLangMap: Record<string, string> = {
      "Brasil": "pt-BR", "Brazil": "pt-BR", "BR": "pt-BR",
      "Portugal": "pt", "PT": "pt",
      "España": "es", "Spain": "es", "ES": "es",
      "México": "es", "Mexico": "es", "MX": "es",
      "Argentina": "es", "AR": "es", "Colombia": "es", "CO": "es",
      "Chile": "es", "CL": "es", "Peru": "es", "PE": "es",
    };
    const countryLang = country ? countryLangMap[country] : null;
    const lang = countryLang || language || "pt-BR";
    const today = new Date().toISOString().split("T")[0];
    const locationCtx = country
      ? `The user is located in ${country}. Focus local points on national-level context (country-wide trends, culture, events). Do NOT narrow to a specific city.`
      : "The user's location is unknown.";

    const langName = lang.startsWith("pt") ? "Portuguese (Brazil)" : lang.startsWith("es") ? "Spanish" : "English";

    const isGeneric = topic === "__generic__";
    const topicInstruction = isGeneric
      ? `No specific topic was provided. Generate broad, interesting conversation starters that would work for any casual conversation between two people. Include trending cultural topics, fun debates, and thought-provoking questions.`
      : `Given a topic, generate two sets of talking points for a natural conversation between two people.`;

    const systemPrompt = `You are a conversation coach. ${topicInstruction}

1. "local_points": 4-5 bullets ${isGeneric ? "about popular current topics" : "about the topic"} contextualized to the user's local region/country, referencing local events, culture, or trends as of ${today}.
2. "global_points": 4-5 bullets ${isGeneric ? "about popular current topics" : "about the topic"} from a global/international perspective, referencing world trends and events as of ${today}.

${locationCtx}

Each bullet should be a short phrase or provocative question that sparks natural dialogue. Write in ${langName}.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: isGeneric ? "Suggest interesting conversation topics." : `Topic: "${topic}"` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_talking_points",
              description: "Return local and global talking point bullets.",
              parameters: {
                type: "object",
                properties: {
                  local_points: {
                    type: "array",
                    items: { type: "string" },
                    description: "4-5 locally contextualized talking points",
                  },
                  global_points: {
                    type: "array",
                    items: { type: "string" },
                    description: "4-5 globally contextualized talking points",
                  },
                },
                required: ["local_points", "global_points"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_talking_points" } },
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
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify({
        local_points: parsed.local_points || [],
        global_points: parsed.global_points || [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback
    return new Response(JSON.stringify({ local_points: [], global_points: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-talking-points error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
