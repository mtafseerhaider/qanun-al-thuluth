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
    PostgrestVersion: "16.4"
  }
  public: {
    Tables: {
      ai_model_routes: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          model: string
          params: NonNullable<Json>
          priority: number
          provider: string
          route_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          model: string
          params?: NonNullable<Json>
          priority?: number
          provider: string
          route_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          model?: string
          params?: NonNullable<Json>
          priority?: number
          provider?: string
          route_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          cost_usd_micros: number
          created_at: string
          household_id: string | null
          id: string
          latency_ms: number | null
          model: string
          provider: string
          request_id: string | null
          route_key: string
          status: string
          tokens_in: number
          tokens_out: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cost_usd_micros?: number
          created_at?: string
          household_id?: string | null
          id?: string
          latency_ms?: number | null
          model: string
          provider: string
          request_id?: string | null
          route_key: string
          status?: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cost_usd_micros?: number
          created_at?: string
          household_id?: string | null
          id?: string
          latency_ms?: number | null
          model?: string
          provider?: string
          request_id?: string | null
          route_key?: string
          status?: string
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_default: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_y2026m10: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_y2026m11: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_y2026m12: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events_y2027m01: {
        Row: {
          app_version: string | null
          created_at: string
          event: string
          household_id: string | null
          id: string
          occurred_at: string
          platform: string | null
          props: NonNullable<Json>
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          event: string
          household_id?: string | null
          id?: string
          occurred_at: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          event?: string
          household_id?: string | null
          id?: string
          occurred_at?: string
          platform?: string | null
          props?: NonNullable<Json>
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          rules: NonNullable<Json>
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          rules?: NonNullable<Json>
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          rules?: NonNullable<Json>
          updated_at?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          created_at: string
          deleted_at: string | null
          household_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["household_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          household_id: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["household_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          household_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["household_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          city: string | null
          country_code: string
          created_at: string
          currency: string
          deleted_at: string | null
          family_size: number
          id: string
          name: string
          owner_user_id: string
          region: string | null
          region_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          country_code?: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          family_size?: number
          id?: string
          name: string
          owner_user_id: string
          region?: string | null
          region_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          country_code?: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          family_size?: number
          id?: string
          name?: string
          owner_user_id?: string
          region?: string | null
          region_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          key: string
          updated_at: string
          variables: NonNullable<Json>
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          updated_at?: string
          variables?: NonNullable<Json>
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          updated_at?: string
          variables?: NonNullable<Json>
          version?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          last_event_at: string | null
          last_event_id: string | null
          product_id: string
          raw_event: NonNullable<Json>
          rc_app_user_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          store: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
          will_renew: boolean
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          product_id: string
          raw_event?: NonNullable<Json>
          rc_app_user_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          store: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
          will_renew?: boolean
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          product_id?: string
          raw_event?: NonNullable<Json>
          rc_app_user_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          store?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
          will_renew?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_path: string | null
          country_code: string | null
          created_at: string
          deleted_at: string | null
          display_name: string
          email: string | null
          id: string
          locale: string
          onboarding_completed_at: string | null
          timezone: string
          tradition_preference: Database["public"]["Enums"]["source_tradition"]
          units: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          country_code?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          email?: string | null
          id: string
          locale?: string
          onboarding_completed_at?: string | null
          timezone?: string
          tradition_preference?: Database["public"]["Enums"]["source_tradition"]
          units?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          country_code?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          email?: string | null
          id?: string
          locale?: string
          onboarding_completed_at?: string | null
          timezone?: string
          tradition_preference?: Database["public"]["Enums"]["source_tradition"]
          units?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      age_in_months: { Args: { p_dob: string; p_on?: string }; Returns: number }
      can_author_plans: { Args: { p_household_id: string }; Returns: boolean }
      can_edit_household: { Args: { p_household_id: string }; Returns: boolean }
      compute_bmi: {
        Args: { p_height_cm: number; p_weight_kg: number }
        Returns: number
      }
      has_premium: { Args: { p_user_id: string }; Returns: boolean }
      household_has_premium: {
        Args: { p_household_id: string }
        Returns: boolean
      }
      household_role_of: {
        Args: { p_household_id: string }
        Returns: Database["public"]["Enums"]["household_role"]
      }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_household_member: {
        Args: { p_household_id: string }
        Returns: boolean
      }
      is_minor: { Args: { p_dob: string; p_on?: string }; Returns: boolean }
      life_stage_for_dob: {
        Args: { p_dob: string; p_on?: string }
        Returns: Database["public"]["Enums"]["life_stage"]
      }
      my_household_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean }
      soft_delete: {
        Args: { p_id: string; p_table: string }
        Returns: undefined
      }
      transfer_household_ownership: {
        Args: { p_household_id: string; p_new_owner: string }
        Returns: undefined
      }
    }
    Enums: {
      acceptance_score:
        | "0_refused"
        | "1_tolerated"
        | "2_touched"
        | "3_tasted"
        | "4_ate_some"
        | "5_ate_well"
      activity_level:
        | "sedentary"
        | "light"
        | "moderate"
        | "active"
        | "very_active"
      blood_group:
        | "A+"
        | "A-"
        | "B+"
        | "B-"
        | "AB+"
        | "AB-"
        | "O+"
        | "O-"
        | "unknown"
      chat_role: "user" | "assistant" | "system" | "tool"
      evidence_grade_hadith:
        | "sahih"
        | "hasan"
        | "daif"
        | "mawdu"
        | "sahih_shia"
        | "muwaththaq"
        | "hasan_shia"
        | "daif_shia"
        | "ungraded"
      evidence_grade_science:
        | "high"
        | "moderate"
        | "low"
        | "very_low"
        | "expert_opinion"
      exposure_stage:
        | "tolerate_on_table"
        | "look"
        | "touch"
        | "smell"
        | "lick"
        | "taste"
        | "chew_spit"
        | "eat_small"
        | "eat_portion"
      fast_kind:
        | "ramadan"
        | "sunnah_monday_thursday"
        | "ayyam_al_bid"
        | "arafah"
        | "ashura"
        | "qada"
        | "nafl"
        | "intermittent"
      goal_type:
        | "weight_loss"
        | "weight_gain"
        | "maintain"
        | "child_growth"
        | "energy"
        | "digestive_health"
        | "pregnancy_support"
        | "breastfeeding_support"
        | "blood_sugar"
        | "heart_health"
      household_role: "owner" | "caregiver" | "viewer" | "coach"
      life_stage:
        | "infant"
        | "toddler"
        | "child"
        | "teen"
        | "adult"
        | "older_adult"
      meal_status: "planned" | "eaten" | "partly_eaten" | "skipped" | "swapped"
      meal_type: "suhoor" | "breakfast" | "lunch" | "snack" | "dinner" | "iftar"
      notification_channel: "push" | "in_app" | "email"
      plan_kind:
        | "standard"
        | "ramadan"
        | "growth"
        | "weight_management"
        | "custom"
      plan_status:
        | "draft"
        | "generating"
        | "active"
        | "completed"
        | "archived"
        | "failed"
      price_source: "seed" | "user_report" | "admin" | "partner_feed"
      severity: "mild" | "moderate" | "severe" | "anaphylactic"
      sex_at_birth: "female" | "male" | "unspecified"
      source_kind: "quran" | "hadith" | "imam_narration" | "scholarly"
      source_tradition: "shared" | "sunni" | "shia"
      special_module:
        | "pregnancy"
        | "breastfeeding"
        | "autism"
        | "adhd"
        | "picky_eater"
      subscription_status:
        | "active"
        | "in_grace"
        | "in_billing_retry"
        | "cancelled"
        | "expired"
        | "paused"
      subscription_tier: "free" | "premium"
      texture:
        | "smooth"
        | "soft"
        | "crunchy"
        | "chewy"
        | "crispy"
        | "mixed"
        | "lumpy"
        | "wet"
        | "dry"
      verification_status: "unverified" | "in_review" | "verified" | "rejected"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      acceptance_score: [
        "0_refused",
        "1_tolerated",
        "2_touched",
        "3_tasted",
        "4_ate_some",
        "5_ate_well",
      ],
      activity_level: [
        "sedentary",
        "light",
        "moderate",
        "active",
        "very_active",
      ],
      blood_group: [
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
        "unknown",
      ],
      chat_role: ["user", "assistant", "system", "tool"],
      evidence_grade_hadith: [
        "sahih",
        "hasan",
        "daif",
        "mawdu",
        "sahih_shia",
        "muwaththaq",
        "hasan_shia",
        "daif_shia",
        "ungraded",
      ],
      evidence_grade_science: [
        "high",
        "moderate",
        "low",
        "very_low",
        "expert_opinion",
      ],
      exposure_stage: [
        "tolerate_on_table",
        "look",
        "touch",
        "smell",
        "lick",
        "taste",
        "chew_spit",
        "eat_small",
        "eat_portion",
      ],
      fast_kind: [
        "ramadan",
        "sunnah_monday_thursday",
        "ayyam_al_bid",
        "arafah",
        "ashura",
        "qada",
        "nafl",
        "intermittent",
      ],
      goal_type: [
        "weight_loss",
        "weight_gain",
        "maintain",
        "child_growth",
        "energy",
        "digestive_health",
        "pregnancy_support",
        "breastfeeding_support",
        "blood_sugar",
        "heart_health",
      ],
      household_role: ["owner", "caregiver", "viewer", "coach"],
      life_stage: [
        "infant",
        "toddler",
        "child",
        "teen",
        "adult",
        "older_adult",
      ],
      meal_status: ["planned", "eaten", "partly_eaten", "skipped", "swapped"],
      meal_type: ["suhoor", "breakfast", "lunch", "snack", "dinner", "iftar"],
      notification_channel: ["push", "in_app", "email"],
      plan_kind: [
        "standard",
        "ramadan",
        "growth",
        "weight_management",
        "custom",
      ],
      plan_status: [
        "draft",
        "generating",
        "active",
        "completed",
        "archived",
        "failed",
      ],
      price_source: ["seed", "user_report", "admin", "partner_feed"],
      severity: ["mild", "moderate", "severe", "anaphylactic"],
      sex_at_birth: ["female", "male", "unspecified"],
      source_kind: ["quran", "hadith", "imam_narration", "scholarly"],
      source_tradition: ["shared", "sunni", "shia"],
      special_module: [
        "pregnancy",
        "breastfeeding",
        "autism",
        "adhd",
        "picky_eater",
      ],
      subscription_status: [
        "active",
        "in_grace",
        "in_billing_retry",
        "cancelled",
        "expired",
        "paused",
      ],
      subscription_tier: ["free", "premium"],
      texture: [
        "smooth",
        "soft",
        "crunchy",
        "chewy",
        "crispy",
        "mixed",
        "lumpy",
        "wet",
        "dry",
      ],
      verification_status: ["unverified", "in_review", "verified", "rejected"],
    },
  },
} as const

