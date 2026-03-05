import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Client,
  Campaign,
  GeographicScope,
  LanguageVariant,
  RewardConfig,
  QualityFlow,
  CampaignTaskSet,
  ValidationRule,
  TaskTypeCatalog,
} from "@/lib/campaignTypes";
import { CATEGORY_VALIDATION_TABLE, TASK_TYPE_CATEGORIES } from "@/lib/campaignTypes";

export type { Client, Campaign, GeographicScope, LanguageVariant, RewardConfig, QualityFlow, CampaignTaskSet, ValidationRule, TaskTypeCatalog };

// --- Task Type Catalog ---
export function useTaskTypeCatalog() {
  return useQuery({
    queryKey: ["task_type_catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_type_catalog")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as TaskTypeCatalog[];
    },
  });
}

// --- Clients ---
export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data as Client[];
    },
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

// --- Fetch task set validation rules based on category ---
function getValidationTableForCategory(category: string): string {
  return CATEGORY_VALIDATION_TABLE[category] || "campaign_audio_validation";
}

async function fetchTaskSetValidation(taskSetId: string, category: string): Promise<{ tech: ValidationRule[]; content: ValidationRule[] }> {
  if (category === "audio") {
    // Audio uses legacy tables
    const [audioRes, contentRes] = await Promise.all([
      supabase.from("campaign_audio_validation").select("*").eq("task_set_id", taskSetId),
      supabase.from("campaign_content_validation").select("*").eq("task_set_id", taskSetId),
    ]);
    return {
      tech: (audioRes.data || []) as ValidationRule[],
      content: (contentRes.data || []) as ValidationRule[],
    };
  }
  // Other categories use unified tables with validation_scope
  const table = getValidationTableForCategory(category) as any;
  const { data } = await supabase.from(table).select("*").eq("task_set_id", taskSetId);
  const rows = (data || []) as ValidationRule[];
  return {
    tech: rows.filter(r => r.validation_scope === "technical"),
    content: rows.filter(r => r.validation_scope === "content"),
  };
}

// --- Fetch campaign relations ---
async function fetchCampaignRelations(campaignId: string) {
  const [geoRes, langRes, taskSetsRes, rewardRes, qualityRes] = await Promise.all([
    supabase.from("campaign_geographic_scope").select("*").eq("campaign_id", campaignId).maybeSingle(),
    supabase.from("campaign_language_variants").select("*").eq("campaign_id", campaignId),
    supabase.from("campaign_task_sets").select("*").eq("campaign_id", campaignId).order("weight"),
    supabase.from("campaign_reward_config").select("*").eq("campaign_id", campaignId).maybeSingle(),
    supabase.from("campaign_quality_flow").select("*").eq("campaign_id", campaignId).maybeSingle(),
  ]);

  // Enrich task sets with validation rules
  const taskSets: CampaignTaskSet[] = await Promise.all(
    (taskSetsRes.data || []).map(async (ts: any) => {
      const category = TASK_TYPE_CATEGORIES[ts.task_type] || "audio";
      const validation = await fetchTaskSetValidation(ts.id, category);
      return {
        ...ts,
        tech_validation: validation.tech,
        content_validation: validation.content,
      } as CampaignTaskSet;
    })
  );

  return {
    geographic_scope: geoRes.data || null,
    language_variants: langRes.data || [],
    task_sets: taskSets,
    reward_config: rewardRes.data || null,
    quality_flow: qualityRes.data || null,
  };
}

// --- Campaigns ---
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
        (campaigns || []).map(async (c: any) => ({
          ...c,
          ...(await fetchCampaignRelations(c.id)),
        } as Campaign))
      );
      return enriched;
    },
  });
}

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
      return { ...campaign, ...(await fetchCampaignRelations(id)) } as Campaign;
    },
    enabled: !!id,
  });
}

// --- Save payload ---
export interface SaveCampaignPayload {
  campaign: Partial<Campaign>;
  geographic_scope?: GeographicScope;
  language_variants?: LanguageVariant[];
  task_sets?: CampaignTaskSet[];
  reward_config?: RewardConfig;
  quality_flow?: QualityFlow;
}

// --- Upsert validation rules for a task set ---
async function upsertTaskSetValidation(taskSetId: string, taskType: string, techRules: ValidationRule[], contentRules: ValidationRule[]) {
  const category = TASK_TYPE_CATEGORIES[taskType] || "audio";

  if (category === "audio") {
    // Audio uses legacy tables
    await supabase.from("campaign_audio_validation").delete().eq("task_set_id", taskSetId);
    if (techRules.length > 0) {
      await supabase.from("campaign_audio_validation").insert(
        techRules.map(r => ({
          task_set_id: taskSetId,
          campaign_id: null as any, // legacy field
          rule_key: r.rule_key,
          min_value: r.min_value,
          max_value: r.max_value,
          target_value: r.target_value ?? null,
          allowed_values: r.allowed_values ?? null,
          is_critical: r.is_critical,
        }))
      );
    }
    await supabase.from("campaign_content_validation").delete().eq("task_set_id", taskSetId);
    if (contentRules.length > 0) {
      await supabase.from("campaign_content_validation").insert(
        contentRules.map(r => ({
          task_set_id: taskSetId,
          campaign_id: null as any,
          rule_key: r.rule_key,
          min_value: r.min_value,
          max_value: r.max_value,
          is_critical: r.is_critical,
        }))
      );
    }
    return;
  }

  // Other categories use unified table
  const table = getValidationTableForCategory(category) as any;
  await supabase.from(table).delete().eq("task_set_id", taskSetId);
  const allRules = [
    ...techRules.map(r => ({ ...r, validation_scope: "technical" })),
    ...contentRules.map(r => ({ ...r, validation_scope: "content" })),
  ];
  if (allRules.length > 0) {
    await supabase.from(table).insert(
      allRules.map(r => ({
        task_set_id: taskSetId,
        validation_scope: r.validation_scope,
        rule_key: r.rule_key,
        min_value: r.min_value ?? null,
        max_value: r.max_value ?? null,
        target_value: r.target_value ?? null,
        allowed_values: r.allowed_values ?? null,
        config: r.config ?? {},
        is_critical: r.is_critical,
      }))
    );
  }
}

// --- Upsert relations ---
async function upsertRelations(campaignId: string, payload: SaveCampaignPayload) {
  // Geographic scope
  await supabase.from("campaign_geographic_scope").delete().eq("campaign_id", campaignId);
  if (payload.geographic_scope) {
    await supabase.from("campaign_geographic_scope").insert({
      campaign_id: campaignId,
      restriction_mode: payload.geographic_scope.restriction_mode,
      continents: payload.geographic_scope.continents,
      countries: payload.geographic_scope.countries,
      regions: payload.geographic_scope.regions,
      states: payload.geographic_scope.states,
      cities: payload.geographic_scope.cities,
    });
  }

  // Language variants
  await supabase.from("campaign_language_variants").delete().eq("campaign_id", campaignId);
  if (payload.language_variants && payload.language_variants.length > 0) {
    await supabase.from("campaign_language_variants").insert(
      payload.language_variants.map(v => ({
        campaign_id: campaignId,
        variant_id: v.variant_id,
        label: v.label,
        notes: v.notes,
        is_primary: v.is_primary,
      }))
    );
  }

  // Task sets
  // First, get existing task sets for cleanup
  const { data: existingTaskSets } = await supabase
    .from("campaign_task_sets")
    .select("id, task_type")
    .eq("campaign_id", campaignId);

  // Delete validation rules for existing task sets before deleting them
  if (existingTaskSets) {
    for (const ts of existingTaskSets) {
      const category = TASK_TYPE_CATEGORIES[ts.task_type] || "audio";
      if (category === "audio") {
        await supabase.from("campaign_audio_validation").delete().eq("task_set_id", ts.id);
        await supabase.from("campaign_content_validation").delete().eq("task_set_id", ts.id);
      } else {
        const table = getValidationTableForCategory(category) as any;
        await supabase.from(table).delete().eq("task_set_id", ts.id);
      }
    }
  }

  await supabase.from("campaign_task_sets").delete().eq("campaign_id", campaignId);

  if (payload.task_sets && payload.task_sets.length > 0) {
    for (const ts of payload.task_sets) {
      const { data: inserted, error } = await supabase
        .from("campaign_task_sets")
        .insert({
          campaign_id: campaignId,
          task_set_id: ts.task_set_id,
          task_type: ts.task_type,
          enabled: ts.enabled,
          weight: ts.weight,
          instructions_title: ts.instructions_title,
          instructions_summary: ts.instructions_summary,
          prompt_topic: ts.prompt_topic,
          prompt_do: ts.prompt_do,
          prompt_dont: ts.prompt_dont,
          admin_rules: ts.admin_rules,
        })
        .select()
        .single();

      if (error) throw error;
      if (inserted) {
        await upsertTaskSetValidation(
          inserted.id,
          ts.task_type,
          ts.tech_validation || [],
          ts.content_validation || []
        );
      }
    }
  }

  // Reward config
  await supabase.from("campaign_reward_config").delete().eq("campaign_id", campaignId);
  if (payload.reward_config) {
    await supabase.from("campaign_reward_config").insert({
      campaign_id: campaignId,
      currency: payload.reward_config.currency,
      payout_model: payload.reward_config.payout_model,
      base_rate: payload.reward_config.base_rate,
      bonus_rate: payload.reward_config.bonus_rate,
      bonus_condition: payload.reward_config.bonus_condition,
    });
  }

  // Quality flow
  await supabase.from("campaign_quality_flow").delete().eq("campaign_id", campaignId);
  if (payload.quality_flow) {
    await supabase.from("campaign_quality_flow").insert({
      campaign_id: campaignId,
      review_mode: payload.quality_flow.review_mode,
      sampling_rate_value: payload.quality_flow.sampling_rate_value,
      sampling_rate_unit: payload.quality_flow.sampling_rate_unit,
      rejection_reasons: payload.quality_flow.rejection_reasons,
    });
  }
}

// --- Mutations ---
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
          schema_version: c.schema_version || "campaign.v1",
          language_primary: c.language_primary,
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
          schema_version: c.schema_version,
          language_primary: c.language_primary,
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
