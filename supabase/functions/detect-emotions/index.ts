import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { turns } = await req.json();

    if (!Array.isArray(turns) || turns.length === 0) {
      return new Response(JSON.stringify({ error: "No turns provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a numbered list of turns for the prompt
    const turnsList = turns
      .map((t: { speaker: string; text: string }, i: number) => `${i}: [${t.speaker}] "${t.text}"`)
      .join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an emotion classifier for conversation transcripts. Classify each speaker turn into exactly ONE emotion from this list: neutral, happy, sad, angry, frustrated, excited, confused, surprised, fearful, disgusted, amused, sarcastic, empathetic, apologetic, confident, hesitant, bored, curious, anxious, relieved. Consider the text content, context, and conversational cues. If uncertain, default to "neutral".`,
          },
          {
            role: "user",
            content: `Classify the emotion for each turn below:\n\n${turnsList}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_emotions",
              description: "Return the classified emotion for each turn by index.",
              parameters: {
                type: "object",
                properties: {
                  emotions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "number", description: "Turn index (0-based)" },
                        emotion: {
                          type: "string",
                          enum: [
                            "neutral", "happy", "sad", "angry", "frustrated",
                            "excited", "confused", "surprised", "fearful", "disgusted",
                            "amused", "sarcastic", "empathetic", "apologetic", "confident",
                            "hesitant", "bored", "curious", "anxious", "relieved",
                          ],
                        },
                      },
                      required: ["index", "emotion"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["emotions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_emotions" } },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Add funds to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "No emotion data returned" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const emotionMap: Record<number, string> = {};
    for (const e of parsed.emotions) {
      emotionMap[e.index] = e.emotion;
    }

    // Build result array matching input order
    const result = turns.map((_: unknown, i: number) => emotionMap[i] || "neutral");

    return new Response(JSON.stringify({ emotions: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("detect-emotions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
