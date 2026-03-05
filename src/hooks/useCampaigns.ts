import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Client,
  Campaign,
  GeographicScope,
  LanguageVariant,
  TaskConfig,
  AdministrativeRules,
  AudioValidationRule,
  ContentValidationRule,
  RewardConfig,
  QualityFlow,
} from "@/lib/campaignTypes";

// Re-export types for convenience
export type { Client, Campaign, GeographicScope, LanguageVariant, TaskConfig, AdministrativeRules, AudioValidationRule, ContentValidationRule, RewardConfig, QualityFlow };

// Fetch all clients
export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Client[];
    },
  });
}

// Fetch all campaigns with all related data
export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data: campaigns, error } = await supabase
        .from("campaigns")
        .select(`*, client:clients(*)`)
        .order("created_at", { ascending: false });

      if (error) throw error;

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
          } as Campaign;
        })
      );

      return enriched;
    },
  });
}

// Fetch single campaign with all relations
export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      if (!id) return null;
      const { data: campaign, error } = await supabase
        .from("campaigns")
        .select(`*, client:clients(*)`)
        .eq("id", id)
        .single();
      if (error) throw error;

      const [geoRes, langRes, taskRes, adminRes, audioRes, contentRes, rewardRes, qualityRes] = await Promise.all([
        supabase.from("campaign_geographic_scope").select("*").eq("campaign_id", id).maybeSingle(),
        supabase.from("campaign_language_variants").select("*").eq("campaign_id", id),
        supabase.from("campaign_task_config").select("*").eq("campaign_id", id).maybeSingle(),
        supabase.from("campaign_administrative_rules").select("*").eq("campaign_id", id).maybeSingle(),
        supabase.from("campaign_audio_validation").select("*").eq("campaign_id", id),
        supabase.from("campaign_content_validation").select("*").eq("campaign_id", id),
        supabase.from("campaign_reward_config").select("*").eq("campaign_id", id).maybeSingle(),
        supabase.from("campaign_quality_flow").select("*").eq("campaign_id", id).maybeSingle(),
      ]);

      return {
        ...campaign,
        geographic_scope: geoRes.data || null,
        language_variants: langRes.data || [],
        task_config: taskRes.data || null,
        administrative_rules: adminRes.data || null,
        audio_validation: audioRes.data || [],
        content_validation: contentRes.data || [],
        reward_config: rewardRes.data || null,
        quality_flow: qualityRes.data || null,
      } as Campaign;
    },
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (client: { name: string; contact_email?: string; contact_phone?: string; notes?: string }) => {
      const { data, error } = await supabase.from("clients").insert([client]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export interface SaveCampaignPayload {
  campaign: Partial<Campaign>;
  geographic_scope?: GeographicScope;
  language_variants?: LanguageVariant[];
  task_config?: TaskConfig;
  administrative_rules?: AdministrativeRules;
  audio_validation?: AudioValidationRule[];
  content_validation?: ContentValidationRule[];
  reward_config?: RewardConfig;
  quality_flow?: QualityFlow;
}

async function upsertRelations(campaignId: string, payload: SaveCampaignPayload) {
  const promises: Promise<any>[] = [];

  // Geographic scope - delete + insert
  promises.push(
    supabase.from("campaign_geographic_scope").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.geographic_scope) {
        return supabase.from("campaign_geographic_scope").insert({
          campaign_id: campaignId,
          restriction_mode: payload.geographic_scope.restriction_mode,
          continents: payload.geographic_scope.continents,
          countries: payload.geographic_scope.countries,
          regions: payload.geographic_scope.regions,
          states: payload.geographic_scope.states,
          cities: payload.geographic_scope.cities,
        });
      }
    })
  );

  // Language variants
  promises.push(
    supabase.from("campaign_language_variants").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.language_variants && payload.language_variants.length > 0) {
        return supabase.from("campaign_language_variants").insert(
          payload.language_variants.map((v) => ({
            campaign_id: campaignId,
            variant_id: v.variant_id,
            label: v.label,
            notes: v.notes,
            is_primary: v.is_primary,
          }))
        );
      }
    })
  );

  // Task config
  promises.push(
    supabase.from("campaign_task_config").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.task_config) {
        return supabase.from("campaign_task_config").insert({
          campaign_id: campaignId,
          task_type: payload.task_config.task_type,
          instructions_title: payload.task_config.instructions_title,
          instructions_summary: payload.task_config.instructions_summary,
          prompt_topic: payload.task_config.prompt_topic,
          prompt_do: payload.task_config.prompt_do,
          prompt_dont: payload.task_config.prompt_dont,
        });
      }
    })
  );

  // Administrative rules
  promises.push(
    supabase.from("campaign_administrative_rules").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.administrative_rules) {
        return supabase.from("campaign_administrative_rules").insert({
          campaign_id: campaignId,
          ...payload.administrative_rules,
          id: undefined,
          campaign_id: campaignId,
        } as any);
      }
    })
  );

  // Audio validation
  promises.push(
    supabase.from("campaign_audio_validation").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.audio_validation && payload.audio_validation.length > 0) {
        return supabase.from("campaign_audio_validation").insert(
          payload.audio_validation.map((r) => ({
            campaign_id: campaignId,
            rule_key: r.rule_key,
            min_value: r.min_value,
            max_value: r.max_value,
            target_value: r.target_value,
            allowed_values: r.allowed_values,
            is_critical: r.is_critical,
          }))
        );
      }
    })
  );

  // Content validation
  promises.push(
    supabase.from("campaign_content_validation").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.content_validation && payload.content_validation.length > 0) {
        return supabase.from("campaign_content_validation").insert(
          payload.content_validation.map((r) => ({
            campaign_id: campaignId,
            rule_key: r.rule_key,
            min_value: r.min_value,
            max_value: r.max_value,
            is_critical: r.is_critical,
          }))
        );
      }
    })
  );

  // Reward config
  promises.push(
    supabase.from("campaign_reward_config").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.reward_config) {
        return supabase.from("campaign_reward_config").insert({
          campaign_id: campaignId,
          currency: payload.reward_config.currency,
          payout_model: payload.reward_config.payout_model,
          base_rate: payload.reward_config.base_rate,
          bonus_rate: payload.reward_config.bonus_rate,
          bonus_condition: payload.reward_config.bonus_condition,
        });
      }
    })
  );

  // Quality flow
  promises.push(
    supabase.from("campaign_quality_flow").delete().eq("campaign_id", campaignId).then(() => {
      if (payload.quality_flow) {
        return supabase.from("campaign_quality_flow").insert({
          campaign_id: campaignId,
          review_mode: payload.quality_flow.review_mode,
          sampling_rate_value: payload.quality_flow.sampling_rate_value,
          sampling_rate_unit: payload.quality_flow.sampling_rate_unit,
          rejection_reasons: payload.quality_flow.rejection_reasons,
        });
      }
    })
  );

  await Promise.all(promises);
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SaveCampaignPayload) => {
      const c = payload.campaign;
      const { data, error } = await supabase
        .from("campaigns")
        .insert({
          name: c.name!,
          description: c.description,
          client_id: c.client_id,
          start_date: c.start_date,
          end_date: c.end_date,
          target_hours: c.target_hours,
          is_active: c.is_active ?? true,
          campaign_type: c.campaign_type,
          campaign_status: c.campaign_status || "draft",
          duration_unit: c.duration_unit,
          duration_value: c.duration_value,
          timezone: c.timezone,
          visibility_is_public: c.visibility_is_public ?? false,
          partner_id: c.partner_id,
        })
        .select()
        .single();
      if (error) throw error;
      await upsertRelations(data.id, payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: SaveCampaignPayload & { id: string }) => {
      const c = payload.campaign;
      const { error } = await supabase
        .from("campaigns")
        .update({
          name: c.name,
          description: c.description,
          client_id: c.client_id,
          start_date: c.start_date,
          end_date: c.end_date,
          target_hours: c.target_hours,
          is_active: c.is_active,
          campaign_type: c.campaign_type,
          campaign_status: c.campaign_status,
          duration_unit: c.duration_unit,
          duration_value: c.duration_value,
          timezone: c.timezone,
          visibility_is_public: c.visibility_is_public,
          partner_id: c.partner_id,
        })
        .eq("id", id);
      if (error) throw error;
      await upsertRelations(id, payload);
      return { id };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign", variables.id] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
