import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TASK_TYPE_LABELS: Record<string, string> = {
  audio_capture_solo: "Audio Capture (Solo)",
  audio_capture_group: "Audio Capture (Group)",
  image_submission: "Image Submission",
  video_submission: "Video Submission",
  data_labeling: "Data Labeling",
  transcription: "Transcription",
  prompt_review: "Prompt Review",
  image_review: "Image Review",
};

const LANG_MAP: Record<string, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { campaignName, campaignDescription, taskTypes, reward, language, format, shortLink } = await req.json();

    const taskLabels = (taskTypes || []).map((t: string) => TASK_TYPE_LABELS[t] || t).join(", ");
    const langName = LANG_MAP[language] || language;
    const rewardText = reward?.base_rate
      ? `${reward.currency || "USD"} ${reward.base_rate}/${reward.payout_model === "per_accepted_hour" ? "hour" : "unit"}`
      : "Competitive pay";

    const prompt = `Create a social media promotional image for a data collection quest/campaign.

DESIGN REQUIREMENTS:
- Dark background (#111111) with a subtle grid pattern of thin lines
- Cyberpunk/brutalist aesthetic with sharp edges, no rounded corners
- Primary accent color: bright lime green (#8cff05)
- Monospace typography throughout
- KGeN logo text in the top-left corner with green accent
- "QUEST" badge in green in the top-right corner

CONTENT (in ${langName}):
- Quest name: "${campaignName}"
- Description: "${campaignDescription || "AI data collection quest"}"
- Task types: ${taskLabels}
- Reward: ${rewardText}
- Call to action button in green at the bottom
- Short URL at bottom-right: "${shortLink}"

DIMENSIONS: ${format.width}x${format.height} pixels (${format.id})
- The image must fill exactly these dimensions

STYLE: Clean, professional, tech-forward. Think crypto/web3 marketing meets data science. Use strong typography hierarchy. The green (#8cff05) should pop against the dark background.

Ultra high resolution.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
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
        return new Response(JSON.stringify({ error: "Payment required. Add credits to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI generation failed");
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      throw new Error("No image returned from AI");
    }

    return new Response(JSON.stringify({ imageUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
