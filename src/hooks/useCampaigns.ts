import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Client {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  country: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Language {
  id: string;
  name: string;
  name_native: string;
  code: string;
  emoji: string | null;
  is_active: boolean | null;
  sort_order: number | null;
}

export interface CampaignSection {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  prompt_text: string | null;
  target_recordings: number | null;
  sort_order: number | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  client_id: string | null;
  start_date: string | null;
  end_date: string | null;
  target_recordings: number | null;
  is_active: boolean | null;
  audio_sample_rate: number | null;
  audio_bit_depth: number | null;
  audio_channels: number | null;
  audio_format: string | null;
  audio_min_duration_seconds: number | null;
  audio_max_duration_seconds: number | null;
  audio_min_snr_db: number | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
  languages?: Language[];
  regions?: Region[];
  sections?: CampaignSection[];
}

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

// Fetch all regions
export function useRegions() {
  return useQuery({
    queryKey: ["regions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regions")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Region[];
    },
  });
}

// Fetch all languages
export function useLanguages() {
  return useQuery({
    queryKey: ["languages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("languages")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as Language[];
    },
  });
}

// Fetch all campaigns with related data
export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data: campaigns, error } = await supabase
        .from("campaigns")
        .select(`
          *,
          client:clients(*)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch languages and regions for each campaign
      const campaignsWithRelations = await Promise.all(
        (campaigns || []).map(async (campaign) => {
          const [languagesRes, regionsRes, sectionsRes] = await Promise.all([
            supabase
              .from("campaign_languages")
              .select("language:languages(*)")
              .eq("campaign_id", campaign.id),
            supabase
              .from("campaign_regions")
              .select("region:regions(*)")
              .eq("campaign_id", campaign.id),
            supabase
              .from("campaign_sections")
              .select("*")
              .eq("campaign_id", campaign.id)
              .order("sort_order"),
          ]);

          return {
            ...campaign,
            languages: languagesRes.data?.map((l: any) => l.language) || [],
            regions: regionsRes.data?.map((r: any) => r.region) || [],
            sections: sectionsRes.data || [],
          } as Campaign;
        })
      );

      return campaignsWithRelations;
    },
  });
}

// Fetch single campaign
export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      if (!id) return null;

      const { data: campaign, error } = await supabase
        .from("campaigns")
        .select(`
          *,
          client:clients(*)
        `)
        .eq("id", id)
        .single();

      if (error) throw error;

      const [languagesRes, regionsRes, sectionsRes] = await Promise.all([
        supabase
          .from("campaign_languages")
          .select("language:languages(*)")
          .eq("campaign_id", id),
        supabase
          .from("campaign_regions")
          .select("region:regions(*)")
          .eq("campaign_id", id),
        supabase
          .from("campaign_sections")
          .select("*")
          .eq("campaign_id", id)
          .order("sort_order"),
      ]);

      return {
        ...campaign,
        languages: languagesRes.data?.map((l: any) => l.language) || [],
        regions: regionsRes.data?.map((r: any) => r.region) || [],
        sections: sectionsRes.data || [],
      } as Campaign;
    },
    enabled: !!id,
  });
}

// Create client mutation
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (client: { name: string; contact_email?: string; contact_phone?: string; notes?: string }) => {
      const { data, error } = await supabase
        .from("clients")
        .insert([client])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

// Create campaign mutation
export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      campaign,
      languageIds,
      regionIds,
      sections,
    }: {
      campaign: Partial<Campaign>;
      languageIds: string[];
      regionIds: string[];
      sections: Partial<CampaignSection>[];
    }) => {
      // Create campaign
      const { data: newCampaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert({
          name: campaign.name,
          description: campaign.description,
          client_id: campaign.client_id,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          target_recordings: campaign.target_recordings,
          is_active: campaign.is_active ?? true,
          audio_sample_rate: campaign.audio_sample_rate,
          audio_bit_depth: campaign.audio_bit_depth,
          audio_channels: campaign.audio_channels,
          audio_format: campaign.audio_format,
          audio_min_duration_seconds: campaign.audio_min_duration_seconds,
          audio_max_duration_seconds: campaign.audio_max_duration_seconds,
          audio_min_snr_db: campaign.audio_min_snr_db,
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      // Add languages
      if (languageIds.length > 0) {
        const { error: langError } = await supabase
          .from("campaign_languages")
          .insert(
            languageIds.map((language_id) => ({
              campaign_id: newCampaign.id,
              language_id,
            }))
          );
        if (langError) throw langError;
      }

      // Add regions
      if (regionIds.length > 0) {
        const { error: regionError } = await supabase
          .from("campaign_regions")
          .insert(
            regionIds.map((region_id) => ({
              campaign_id: newCampaign.id,
              region_id,
            }))
          );
        if (regionError) throw regionError;
      }

      // Add sections
      if (sections.length > 0) {
        const { error: sectionError } = await supabase
          .from("campaign_sections")
          .insert(
            sections.map((section, index) => ({
              campaign_id: newCampaign.id,
              name: section.name,
              description: section.description,
              prompt_text: section.prompt_text,
              target_recordings: section.target_recordings,
              sort_order: index,
              is_active: true,
            }))
          );
        if (sectionError) throw sectionError;
      }

      return newCampaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

// Update campaign mutation
export function useUpdateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      campaign,
      languageIds,
      regionIds,
      sections,
    }: {
      id: string;
      campaign: Partial<Campaign>;
      languageIds: string[];
      regionIds: string[];
      sections: Partial<CampaignSection>[];
    }) => {
      // Update campaign
      const { error: campaignError } = await supabase
        .from("campaigns")
        .update({
          name: campaign.name,
          description: campaign.description,
          client_id: campaign.client_id,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          target_recordings: campaign.target_recordings,
          is_active: campaign.is_active,
          audio_sample_rate: campaign.audio_sample_rate,
          audio_bit_depth: campaign.audio_bit_depth,
          audio_channels: campaign.audio_channels,
          audio_format: campaign.audio_format,
          audio_min_duration_seconds: campaign.audio_min_duration_seconds,
          audio_max_duration_seconds: campaign.audio_max_duration_seconds,
          audio_min_snr_db: campaign.audio_min_snr_db,
        })
        .eq("id", id);

      if (campaignError) throw campaignError;

      // Update languages - delete all and re-insert
      await supabase.from("campaign_languages").delete().eq("campaign_id", id);
      if (languageIds.length > 0) {
        const { error: langError } = await supabase
          .from("campaign_languages")
          .insert(
            languageIds.map((language_id) => ({
              campaign_id: id,
              language_id,
            }))
          );
        if (langError) throw langError;
      }

      // Update regions - delete all and re-insert
      await supabase.from("campaign_regions").delete().eq("campaign_id", id);
      if (regionIds.length > 0) {
        const { error: regionError } = await supabase
          .from("campaign_regions")
          .insert(
            regionIds.map((region_id) => ({
              campaign_id: id,
              region_id,
            }))
          );
        if (regionError) throw regionError;
      }

      // Update sections - delete all and re-insert
      await supabase.from("campaign_sections").delete().eq("campaign_id", id);
      if (sections.length > 0) {
        const { error: sectionError } = await supabase
          .from("campaign_sections")
          .insert(
            sections.map((section, index) => ({
              campaign_id: id,
              name: section.name,
              description: section.description,
              prompt_text: section.prompt_text,
              target_recordings: section.target_recordings,
              sort_order: index,
              is_active: true,
            }))
          );
        if (sectionError) throw sectionError;
      }

      return { id };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign", variables.id] });
    },
  });
}

// Delete campaign mutation
export function useDeleteCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}
