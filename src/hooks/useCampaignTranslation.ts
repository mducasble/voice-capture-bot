import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { Campaign } from "@/lib/campaignTypes";

interface TranslatedContent {
  name: string;
  description: string;
  task_sets: Array<{
    instructions_title: string;
    instructions_summary: string;
    prompt_topic: string;
    prompt_do: string[];
    prompt_dont: string[];
  }>;
  sections: Array<{
    name: string;
    description: string;
    prompt_text: string;
  }>;
  rejection_reasons: string[];
  // Instructions-level fields
  instructions_title?: string;
  instructions_summary?: string;
  instructions_steps?: Array<{ title: string; description: string }>;
  prompt_do?: string[];
  prompt_dont?: string[];
  required_hardware?: string[];
}

function buildTextsPayload(campaign: Campaign) {
  return {
    name: campaign.name,
    description: campaign.description || "",
    task_sets: (campaign.task_sets || []).map(ts => ({
      instructions_title: ts.instructions_title || "",
      instructions_summary: ts.instructions_summary || "",
      prompt_topic: ts.prompt_topic || "",
      prompt_do: ts.prompt_do || [],
      prompt_dont: ts.prompt_dont || [],
    })),
    sections: (campaign.sections || []).map(s => ({
      name: s.name || "",
      description: s.description || "",
      prompt_text: s.prompt_text || "",
    })),
    rejection_reasons: campaign.quality_flow?.rejection_reasons || [],
    // Also send campaign-level instructions
    instructions_title: campaign.instructions?.instructions_title || "",
    instructions_summary: campaign.instructions?.instructions_summary || "",
    instructions_steps: campaign.instructions?.instructions_steps || [],
    prompt_do: campaign.instructions?.prompt_do || [],
    prompt_dont: campaign.instructions?.prompt_dont || [],
    required_hardware: campaign.instructions?.required_hardware || [],
  };
}

const LANG_MAP: Record<string, string> = {
  pt: "Portuguese (Brazil)",
  en: "English",
  es: "Spanish",
};

export function useCampaignTranslation(campaign: Campaign | null | undefined) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.substring(0, 2) || "pt";
  const needsTranslation = lang !== "pt" && !!campaign;

  const { data: translated, isLoading } = useQuery({
    queryKey: ["campaign-translation", "v2", campaign?.id, lang],
    queryFn: async (): Promise<TranslatedContent> => {
      const texts = buildTextsPayload(campaign!);
      const { data, error } = await supabase.functions.invoke("translate-campaign", {
        body: { texts, target_language: LANG_MAP[lang] || "English" },
      });
      if (error) throw error;
      // Handle both wrapped and unwrapped response formats
      const result = data?.translated || data;
      console.log("[translation] lang=", lang, "result keys=", Object.keys(result || {}));
      return result as TranslatedContent;
    },
    enabled: needsTranslation,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  if (!needsTranslation || !translated) {
    return { translated: null, isTranslating: needsTranslation && isLoading };
  }

  return { translated, isTranslating: isLoading };
}
