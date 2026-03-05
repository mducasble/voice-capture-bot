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
      campaigns: {
        Row: {
          audio_bit_depth: number | null
          audio_channels: number | null
          audio_format: string | null
          audio_max_duration_seconds: number | null
          audio_min_duration_seconds: number | null
          audio_min_snr_db: number | null
          audio_sample_rate: number | null
          client_id: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          name: string
          start_date: string | null
          target_hours: number | null
          updated_at: string
        }
        Insert: {
          audio_bit_depth?: number | null
          audio_channels?: number | null
          audio_format?: string | null
          audio_max_duration_seconds?: number | null
          audio_min_duration_seconds?: number | null
          audio_min_snr_db?: number | null
          audio_sample_rate?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          start_date?: string | null
          target_hours?: number | null
          updated_at?: string
        }
        Update: {
          audio_bit_depth?: number | null
          audio_channels?: number | null
          audio_format?: string | null
          audio_max_duration_seconds?: number | null
          audio_min_duration_seconds?: number | null
          audio_min_snr_db?: number | null
          audio_sample_rate?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          start_date?: string | null
          target_hours?: number | null
          updated_at?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
      recording_status: ["uploading", "processing", "completed", "failed"],
    },
  },
} as const
