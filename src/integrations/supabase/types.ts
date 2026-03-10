export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      annotation_submissions: {
        Row: {
          annotation_data: Json | null
          campaign_id: string
          created_at: string
          id: string
          metadata: Json | null
          quality_rejection_reason: string | null
          quality_reviewed_at: string | null
          quality_reviewed_by: string | null
          quality_status: string | null
          section_id: string | null
          source_submission_id: string | null
          source_submission_type: string | null
          task_set_id: string | null
          updated_at: string
          user_id: string
          validation_rejection_reason: string | null
          validation_reviewed_at: string | null
          validation_reviewed_by: string | null
          validation_status: string | null
        }
        Insert: {
          annotation_data?: Json | null
          campaign_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          source_submission_id?: string | null
          source_submission_type?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
        }
        Update: {
          annotation_data?: Json | null
          campaign_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          source_submission_id?: string | null
          source_submission_type?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id?: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "annotation_submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annotation_submissions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "campaign_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annotation_submissions_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_administrative_rules: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          max_hours_per_partner_per_user: number | null
          max_hours_per_user: number | null
          max_participants_per_session: number | null
          max_sessions_per_user: number | null
          min_acceptance_rate: number | null
          min_acceptance_rate_unit: string | null
          min_participants_per_session: number | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          max_hours_per_partner_per_user?: number | null
          max_hours_per_user?: number | null
          max_participants_per_session?: number | null
          max_sessions_per_user?: number | null
          min_acceptance_rate?: number | null
          min_acceptance_rate_unit?: string | null
          min_participants_per_session?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          max_hours_per_partner_per_user?: number | null
          max_hours_per_user?: number | null
          max_participants_per_session?: number | null
          max_sessions_per_user?: number | null
          min_acceptance_rate?: number | null
          min_acceptance_rate_unit?: string | null
          min_participants_per_session?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_administrative_rules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_annotation_validation: {
        Row: {
          allowed_values: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string
          validation_scope: string
        }
        Insert: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id: string
          validation_scope?: string
        }
        Update: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string
          validation_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_annotation_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_audio_validation: {
        Row: {
          allowed_values: Json | null
          campaign_id: string
          created_at: string
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string | null
        }
        Insert: {
          allowed_values?: Json | null
          campaign_id: string
          created_at?: string
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id?: string | null
        }
        Update: {
          allowed_values?: Json | null
          campaign_id?: string
          created_at?: string
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_audio_validation_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_audio_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_content_validation: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          task_set_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          task_set_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          task_set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_content_validation_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_content_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_geographic_scope: {
        Row: {
          campaign_id: string
          cities: string[] | null
          continents: string[] | null
          countries: string[] | null
          created_at: string
          id: string
          regions: string[] | null
          restriction_mode: string | null
          states: string[] | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          cities?: string[] | null
          continents?: string[] | null
          countries?: string[] | null
          created_at?: string
          id?: string
          regions?: string[] | null
          restriction_mode?: string | null
          states?: string[] | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          cities?: string[] | null
          continents?: string[] | null
          countries?: string[] | null
          created_at?: string
          id?: string
          regions?: string[] | null
          restriction_mode?: string | null
          states?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_geographic_scope_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_image_validation: {
        Row: {
          allowed_values: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string
          validation_scope: string
        }
        Insert: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id: string
          validation_scope?: string
        }
        Update: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string
          validation_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_image_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_instructions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          instructions_steps: Json | null
          instructions_summary: string | null
          instructions_title: string | null
          pdf_file_url: string | null
          prompt_do: string[] | null
          prompt_dont: string[] | null
          required_hardware: string[] | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          instructions_steps?: Json | null
          instructions_summary?: string | null
          instructions_title?: string | null
          pdf_file_url?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          required_hardware?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          instructions_steps?: Json | null
          instructions_summary?: string | null
          instructions_title?: string | null
          pdf_file_url?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          required_hardware?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_instructions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_language_variants: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          is_primary: boolean | null
          label: string
          notes: string | null
          variant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          label: string
          notes?: string | null
          variant_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          label?: string
          notes?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_language_variants_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_languages: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          language_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          language_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          language_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_languages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_languages_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_participants: {
        Row: {
          campaign_id: string
          id: string
          joined_at: string
          status: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          id?: string
          joined_at?: string
          status?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          id?: string
          joined_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_participants_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_quality_flow: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          rejection_reasons: string[] | null
          review_mode: string | null
          sampling_rate_unit: string | null
          sampling_rate_value: number | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          rejection_reasons?: string[] | null
          review_mode?: string | null
          sampling_rate_unit?: string | null
          sampling_rate_value?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          rejection_reasons?: string[] | null
          review_mode?: string | null
          sampling_rate_unit?: string | null
          sampling_rate_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_quality_flow_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_regions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          region_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          region_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_regions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_regions_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_review_validation: {
        Row: {
          allowed_values: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string
          validation_scope: string
        }
        Insert: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id: string
          validation_scope?: string
        }
        Update: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string
          validation_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_review_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_reward_config: {
        Row: {
          base_rate: number | null
          bonus_condition: string | null
          bonus_rate: number | null
          campaign_id: string
          created_at: string
          currency: string | null
          id: string
          payment_type: string
          payout_model: string | null
          updated_at: string
        }
        Insert: {
          base_rate?: number | null
          bonus_condition?: string | null
          bonus_rate?: number | null
          campaign_id: string
          created_at?: string
          currency?: string | null
          id?: string
          payment_type?: string
          payout_model?: string | null
          updated_at?: string
        }
        Update: {
          base_rate?: number | null
          bonus_condition?: string | null
          bonus_rate?: number | null
          campaign_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          payment_type?: string
          payout_model?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_reward_config_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_sections: {
        Row: {
          campaign_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          prompt_text: string | null
          sort_order: number | null
          target_hours: number | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          prompt_text?: string | null
          sort_order?: number | null
          target_hours?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          prompt_text?: string | null
          sort_order?: number | null
          target_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_task_config: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          instructions_summary: string | null
          instructions_title: string | null
          prompt_do: string[] | null
          prompt_dont: string[] | null
          prompt_topic: string | null
          task_type: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          instructions_summary?: string | null
          instructions_title?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          prompt_topic?: string | null
          task_type?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          instructions_summary?: string | null
          instructions_title?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          prompt_topic?: string | null
          task_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_task_config_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_task_sets: {
        Row: {
          admin_rules: Json | null
          campaign_id: string
          created_at: string | null
          enabled: boolean | null
          id: string
          instructions_summary: string | null
          instructions_title: string | null
          prompt_do: string[] | null
          prompt_dont: string[] | null
          prompt_topic: string | null
          task_set_id: string
          task_type: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          admin_rules?: Json | null
          campaign_id: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          instructions_summary?: string | null
          instructions_title?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          prompt_topic?: string | null
          task_set_id: string
          task_type: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          admin_rules?: Json | null
          campaign_id?: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          instructions_summary?: string | null
          instructions_title?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          prompt_topic?: string | null
          task_set_id?: string
          task_type?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_task_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_task_sets_task_type_fkey"
            columns: ["task_type"]
            isOneToOne: false
            referencedRelation: "task_type_catalog"
            referencedColumns: ["task_type"]
          },
        ]
      }
      campaign_text_validation: {
        Row: {
          allowed_values: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string
          validation_scope: string
        }
        Insert: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id: string
          validation_scope?: string
        }
        Update: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string
          validation_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_text_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_video_validation: {
        Row: {
          allowed_values: Json | null
          config: Json | null
          created_at: string | null
          id: string
          is_critical: boolean | null
          max_value: number | null
          min_value: number | null
          rule_key: string
          target_value: number | null
          task_set_id: string
          validation_scope: string
        }
        Insert: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key: string
          target_value?: number | null
          task_set_id: string
          validation_scope?: string
        }
        Update: {
          allowed_values?: Json | null
          config?: Json | null
          created_at?: string | null
          id?: string
          is_critical?: boolean | null
          max_value?: number | null
          min_value?: number | null
          rule_key?: string
          target_value?: number | null
          task_set_id?: string
          validation_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_video_validation_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_waitlist: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_waitlist_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          accumulated_value: number
          audio_bit_depth: number | null
          audio_channels: number | null
          audio_format: string | null
          audio_max_duration_seconds: number | null
          audio_min_duration_seconds: number | null
          audio_min_snr_db: number | null
          audio_sample_rate: number | null
          campaign_status: string | null
          campaign_type: string | null
          client_id: string | null
          created_at: string
          description: string | null
          duration_unit: string | null
          duration_value: number | null
          end_date: string | null
          id: string
          is_active: boolean | null
          language_primary: string | null
          name: string
          partner_id: string | null
          schema_version: string | null
          start_date: string | null
          target_hours: number | null
          timezone: string | null
          updated_at: string
          visibility_is_public: boolean | null
        }
        Insert: {
          accumulated_value?: number
          audio_bit_depth?: number | null
          audio_channels?: number | null
          audio_format?: string | null
          audio_max_duration_seconds?: number | null
          audio_min_duration_seconds?: number | null
          audio_min_snr_db?: number | null
          audio_sample_rate?: number | null
          campaign_status?: string | null
          campaign_type?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_unit?: string | null
          duration_value?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          language_primary?: string | null
          name: string
          partner_id?: string | null
          schema_version?: string | null
          start_date?: string | null
          target_hours?: number | null
          timezone?: string | null
          updated_at?: string
          visibility_is_public?: boolean | null
        }
        Update: {
          accumulated_value?: number
          audio_bit_depth?: number | null
          audio_channels?: number | null
          audio_format?: string | null
          audio_max_duration_seconds?: number | null
          audio_min_duration_seconds?: number | null
          audio_min_snr_db?: number | null
          audio_sample_rate?: number | null
          campaign_status?: string | null
          campaign_type?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          duration_unit?: string | null
          duration_value?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          language_primary?: string | null
          name?: string
          partner_id?: string | null
          schema_version?: string | null
          start_date?: string | null
          target_hours?: number | null
          timezone?: string | null
          updated_at?: string
          visibility_is_public?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      carousel_projects: {
        Row: {
          created_at: string
          created_by: string
          format_id: string
          id: string
          name: string
          slides: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          format_id?: string
          id?: string
          name?: string
          slides?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          format_id?: string
          id?: string
          name?: string
          slides?: Json
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      earnings_ledger: {
        Row: {
          amount: number
          campaign_id: string
          created_at: string
          credited_at: string | null
          currency: string
          description: string | null
          entry_type: string
          id: string
          metadata: Json | null
          paid_at: string | null
          reference_id: string | null
          status: string
          submission_id: string
          submission_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          campaign_id: string
          created_at?: string
          credited_at?: string | null
          currency?: string
          description?: string | null
          entry_type?: string
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          reference_id?: string | null
          status?: string
          submission_id: string
          submission_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          campaign_id?: string
          created_at?: string
          credited_at?: string | null
          currency?: string
          description?: string | null
          entry_type?: string
          id?: string
          metadata?: Json | null
          paid_at?: string | null
          reference_id?: string | null
          status?: string
          submission_id?: string
          submission_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "earnings_ledger_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_items: {
        Row: {
          answer_en: string | null
          answer_es: string | null
          answer_pt: string
          category: string
          created_at: string
          id: string
          is_active: boolean
          question_en: string | null
          question_es: string | null
          question_pt: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer_en?: string | null
          answer_es?: string | null
          answer_pt: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question_en?: string | null
          question_es?: string | null
          question_pt: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer_en?: string | null
          answer_es?: string | null
          answer_pt?: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question_en?: string | null
          question_es?: string | null
          question_pt?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      hardware_catalog: {
        Row: {
          created_at: string
          icon_name: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          icon_name: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          icon_name?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      image_submissions: {
        Row: {
          campaign_id: string
          created_at: string
          file_size_bytes: number | null
          file_url: string | null
          filename: string
          format: string | null
          height: number | null
          id: string
          metadata: Json | null
          quality_rejection_reason: string | null
          quality_reviewed_at: string | null
          quality_reviewed_by: string | null
          quality_status: string | null
          section_id: string | null
          task_set_id: string | null
          updated_at: string
          user_id: string
          validation_rejection_reason: string | null
          validation_reviewed_at: string | null
          validation_reviewed_by: string | null
          validation_status: string | null
          width: number | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          file_size_bytes?: number | null
          file_url?: string | null
          filename: string
          format?: string | null
          height?: number | null
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          width?: number | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          file_size_bytes?: number | null
          file_url?: string | null
          filename?: string
          format?: string | null
          height?: number | null
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id?: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "image_submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_submissions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "campaign_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_submissions_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      instruction_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          instructions_steps: Json | null
          instructions_summary: string | null
          instructions_title: string | null
          name: string
          pdf_file_url: string | null
          prompt_do: string[] | null
          prompt_dont: string[] | null
          required_hardware: string[] | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          instructions_steps?: Json | null
          instructions_summary?: string | null
          instructions_title?: string | null
          name: string
          pdf_file_url?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          required_hardware?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          instructions_steps?: Json | null
          instructions_summary?: string | null
          instructions_title?: string | null
          name?: string
          pdf_file_url?: string | null
          prompt_do?: string[] | null
          prompt_dont?: string[] | null
          required_hardware?: string[] | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      languages: {
        Row: {
          code: string
          created_at: string
          emoji: string | null
          id: string
          is_active: boolean | null
          name: string
          name_native: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_native: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_native?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      maintenance_config: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          message: string | null
          scheduled_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          desired_opportunities: string[] | null
          email_contact: string | null
          full_name: string | null
          id: string
          referral_code: string | null
          spoken_languages: string[] | null
          telegram: string | null
          updated_at: string
          wallet_id: string | null
          whatsapp: string | null
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          desired_opportunities?: string[] | null
          email_contact?: string | null
          full_name?: string | null
          id: string
          referral_code?: string | null
          spoken_languages?: string[] | null
          telegram?: string | null
          updated_at?: string
          wallet_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          desired_opportunities?: string[] | null
          email_contact?: string | null
          full_name?: string | null
          id?: string
          referral_code?: string | null
          spoken_languages?: string[] | null
          telegram?: string | null
          updated_at?: string
          wallet_id?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      prompt_rules_catalog: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean | null
          rule_text: string
          rule_type: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          rule_text: string
          rule_type?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          rule_text?: string
          rule_type?: string
        }
        Relationships: []
      }
      recording_topics: {
        Row: {
          created_at: string
          description: string | null
          emoji: string | null
          id: string
          is_active: boolean | null
          name: string
          name_en: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_en: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_en?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      referral_config: {
        Row: {
          campaign_id: string | null
          cascade_keep_ratio: number
          created_at: string
          id: string
          max_levels: number
          pool_fixed_amount: number | null
          pool_percent: number
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          cascade_keep_ratio?: number
          created_at?: string
          id?: string
          max_levels?: number
          pool_fixed_amount?: number | null
          pool_percent?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          cascade_keep_ratio?: number
          created_at?: string
          id?: string
          max_levels?: number
          pool_fixed_amount?: number | null
          pool_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_config_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          level_1: string | null
          level_2: string | null
          level_3: string | null
          level_4: string | null
          level_5: string | null
          referred_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level_1?: string | null
          level_2?: string | null
          level_3?: string | null
          level_4?: string | null
          level_5?: string | null
          referred_by: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level_1?: string | null
          level_2?: string | null
          level_3?: string | null
          level_4?: string | null
          level_5?: string | null
          referred_by?: string
          user_id?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          code: string
          country: string | null
          created_at: string
          id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      room_participants: {
        Row: {
          audio_test_results: Json | null
          audio_test_status: string
          id: string
          is_connected: boolean | null
          is_creator: boolean | null
          joined_at: string
          left_at: string | null
          name: string
          room_id: string
          user_id: string | null
        }
        Insert: {
          audio_test_results?: Json | null
          audio_test_status?: string
          id?: string
          is_connected?: boolean | null
          is_creator?: boolean | null
          joined_at?: string
          left_at?: string | null
          name: string
          room_id: string
          user_id?: string | null
        }
        Update: {
          audio_test_results?: Json | null
          audio_test_status?: string
          id?: string
          is_connected?: boolean | null
          is_creator?: boolean | null
          joined_at?: string
          left_at?: string | null
          name?: string
          room_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          creator_name: string
          duration_minutes: number | null
          id: string
          is_recording: boolean | null
          noise_gate_enabled: boolean
          recording_started_at: string | null
          room_name: string | null
          session_id: string | null
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_name: string
          duration_minutes?: number | null
          id?: string
          is_recording?: boolean | null
          noise_gate_enabled?: boolean
          recording_started_at?: string | null
          room_name?: string | null
          session_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_name?: string
          duration_minutes?: number | null
          id?: string
          is_recording?: boolean | null
          noise_gate_enabled?: boolean
          recording_started_at?: string | null
          room_name?: string | null
          session_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      short_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          slug: string
          target_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          slug: string
          target_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          slug?: string
          target_path?: string
        }
        Relationships: []
      }
      task_type_catalog: {
        Row: {
          category: string
          created_at: string | null
          default_admin_rules: Json | null
          default_content_validation: Json | null
          default_tech_validation: Json | null
          is_active: boolean | null
          primary_unit: string
          secondary_unit: string | null
          sort_order: number | null
          task_type: string
          ui_label: string
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          default_admin_rules?: Json | null
          default_content_validation?: Json | null
          default_tech_validation?: Json | null
          is_active?: boolean | null
          primary_unit?: string
          secondary_unit?: string | null
          sort_order?: number | null
          task_type: string
          ui_label: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          default_admin_rules?: Json | null
          default_content_validation?: Json | null
          default_tech_validation?: Json | null
          is_active?: boolean | null
          primary_unit?: string
          secondary_unit?: string | null
          sort_order?: number | null
          task_type?: string
          ui_label?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      text_submissions: {
        Row: {
          campaign_id: string
          content: string | null
          created_at: string
          id: string
          language: string | null
          metadata: Json | null
          quality_rejection_reason: string | null
          quality_reviewed_at: string | null
          quality_reviewed_by: string | null
          quality_status: string | null
          section_id: string | null
          task_set_id: string | null
          updated_at: string
          user_id: string
          validation_rejection_reason: string | null
          validation_reviewed_at: string | null
          validation_reviewed_by: string | null
          validation_status: string | null
          word_count: number | null
        }
        Insert: {
          campaign_id: string
          content?: string | null
          created_at?: string
          id?: string
          language?: string | null
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          word_count?: number | null
        }
        Update: {
          campaign_id?: string
          content?: string | null
          created_at?: string
          id?: string
          language?: string | null
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id?: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "text_submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_submissions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "campaign_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_submissions_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_applications: {
        Row: {
          company_name: string | null
          created_at: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      video_submissions: {
        Row: {
          campaign_id: string
          created_at: string
          duration_seconds: number | null
          file_size_bytes: number | null
          file_url: string | null
          filename: string
          format: string | null
          frame_rate: number | null
          height: number | null
          id: string
          metadata: Json | null
          quality_rejection_reason: string | null
          quality_reviewed_at: string | null
          quality_reviewed_by: string | null
          quality_status: string | null
          section_id: string | null
          task_set_id: string | null
          updated_at: string
          user_id: string
          validation_rejection_reason: string | null
          validation_reviewed_at: string | null
          validation_reviewed_by: string | null
          validation_status: string | null
          width: number | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_url?: string | null
          filename: string
          format?: string | null
          frame_rate?: number | null
          height?: number | null
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          width?: number | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_url?: string | null
          filename?: string
          format?: string | null
          frame_rate?: number | null
          height?: number | null
          id?: string
          metadata?: Json | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          section_id?: string | null
          task_set_id?: string | null
          updated_at?: string
          user_id?: string
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_submissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_submissions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "campaign_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_submissions_task_set_id_fkey"
            columns: ["task_set_id"]
            isOneToOne: false
            referencedRelation: "campaign_task_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_recordings: {
        Row: {
          bit_depth: number | null
          campaign_id: string | null
          channels: number | null
          created_at: string
          discord_channel_id: string
          discord_channel_name: string | null
          discord_guild_id: string
          discord_guild_name: string | null
          discord_user_id: string
          discord_username: string | null
          duration_seconds: number | null
          elevenlabs_chunk_state: Json | null
          file_size_bytes: number | null
          file_url: string | null
          filename: string
          format: string | null
          gemini_chunk_state: Json | null
          id: string
          language: string | null
          metadata: Json | null
          mp3_file_url: string | null
          quality_rejection_reason: string | null
          quality_reviewed_at: string | null
          quality_reviewed_by: string | null
          quality_status: string | null
          recording_type: string | null
          sample_rate: number | null
          section_id: string | null
          session_id: string | null
          snr_db: number | null
          status: Database["public"]["Enums"]["recording_status"] | null
          topic_id: string | null
          transcription: string | null
          transcription_elevenlabs: string | null
          transcription_elevenlabs_status: string | null
          transcription_status: string | null
          updated_at: string
          user_id: string | null
          validation_rejection_reason: string | null
          validation_reviewed_at: string | null
          validation_reviewed_by: string | null
          validation_status: string | null
        }
        Insert: {
          bit_depth?: number | null
          campaign_id?: string | null
          channels?: number | null
          created_at?: string
          discord_channel_id: string
          discord_channel_name?: string | null
          discord_guild_id: string
          discord_guild_name?: string | null
          discord_user_id: string
          discord_username?: string | null
          duration_seconds?: number | null
          elevenlabs_chunk_state?: Json | null
          file_size_bytes?: number | null
          file_url?: string | null
          filename: string
          format?: string | null
          gemini_chunk_state?: Json | null
          id?: string
          language?: string | null
          metadata?: Json | null
          mp3_file_url?: string | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          recording_type?: string | null
          sample_rate?: number | null
          section_id?: string | null
          session_id?: string | null
          snr_db?: number | null
          status?: Database["public"]["Enums"]["recording_status"] | null
          topic_id?: string | null
          transcription?: string | null
          transcription_elevenlabs?: string | null
          transcription_elevenlabs_status?: string | null
          transcription_status?: string | null
          updated_at?: string
          user_id?: string | null
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
        }
        Update: {
          bit_depth?: number | null
          campaign_id?: string | null
          channels?: number | null
          created_at?: string
          discord_channel_id?: string
          discord_channel_name?: string | null
          discord_guild_id?: string
          discord_guild_name?: string | null
          discord_user_id?: string
          discord_username?: string | null
          duration_seconds?: number | null
          elevenlabs_chunk_state?: Json | null
          file_size_bytes?: number | null
          file_url?: string | null
          filename?: string
          format?: string | null
          gemini_chunk_state?: Json | null
          id?: string
          language?: string | null
          metadata?: Json | null
          mp3_file_url?: string | null
          quality_rejection_reason?: string | null
          quality_reviewed_at?: string | null
          quality_reviewed_by?: string | null
          quality_status?: string | null
          recording_type?: string | null
          sample_rate?: number | null
          section_id?: string | null
          session_id?: string | null
          snr_db?: number | null
          status?: Database["public"]["Enums"]["recording_status"] | null
          topic_id?: string | null
          transcription?: string | null
          transcription_elevenlabs?: string | null
          transcription_elevenlabs_status?: string | null
          transcription_status?: string | null
          updated_at?: string
          user_id?: string | null
          validation_rejection_reason?: string | null
          validation_reviewed_at?: string | null
          validation_reviewed_by?: string | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_recordings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_recordings_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "campaign_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_recordings_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "recording_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      webrtc_signals: {
        Row: {
          created_at: string
          id: string
          receiver_id: string
          room_id: string
          sender_id: string
          signal_data: Json
          signal_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          receiver_id: string
          room_id: string
          sender_id: string
          signal_data: Json
          signal_type: string
        }
        Update: {
          created_at?: string
          id?: string
          receiver_id?: string
          room_id?: string
          sender_id?: string
          signal_data?: Json
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "webrtc_signals_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "room_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webrtc_signals_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webrtc_signals_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "room_participants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      expire_old_rooms: { Args: never; Returns: undefined }
      get_my_campaign_recordings: {
        Args: { p_campaign_ids: string[]; p_user_id: string }
        Returns: {
          campaign_id: string
          created_at: string
          discord_username: string
          duration_seconds: number
          file_url: string
          filename: string
          id: string
          quality_rejection_reason: string
          quality_status: string
          recording_type: string
          session_id: string
          snr_db: number
          status: string
          validation_rejection_reason: string
          validation_status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      process_referral: {
        Args: { p_referral_code: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "vendor"
      recording_status: "uploading" | "processing" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "vendor"],
      recording_status: ["uploading", "processing", "completed", "failed"],
    },
  },
} as const
