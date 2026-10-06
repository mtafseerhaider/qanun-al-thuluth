export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '16.4';
  };
  public: {
    Tables: {
      ai_model_routes: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          model: string;
          params: NonNullable<Json>;
          priority: number;
          provider: string;
          route_key: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          model: string;
          params?: NonNullable<Json>;
          priority?: number;
          provider: string;
          route_key: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          model?: string;
          params?: NonNullable<Json>;
          priority?: number;
          provider?: string;
          route_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_usage: {
        Row: {
          cost_usd_micros: number;
          created_at: string;
          household_id: string | null;
          id: string;
          latency_ms: number | null;
          model: string;
          provider: string;
          request_id: string | null;
          route_key: string;
          status: string;
          tokens_in: number;
          tokens_out: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cost_usd_micros?: number;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          latency_ms?: number | null;
          model: string;
          provider: string;
          request_id?: string | null;
          route_key: string;
          status?: string;
          tokens_in?: number;
          tokens_out?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cost_usd_micros?: number;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          latency_ms?: number | null;
          model?: string;
          provider?: string;
          request_id?: string | null;
          route_key?: string;
          status?: string;
          tokens_in?: number;
          tokens_out?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_usage_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_usage_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      allergens: {
        Row: {
          code: string;
          created_at: string;
          eu14: boolean;
          id: string;
          name_i18n: NonNullable<Json>;
          updated_at: string;
          us_big9: boolean;
        };
        Insert: {
          code: string;
          created_at?: string;
          eu14?: boolean;
          id?: string;
          name_i18n: NonNullable<Json>;
          updated_at?: string;
          us_big9?: boolean;
        };
        Update: {
          code?: string;
          created_at?: string;
          eu14?: boolean;
          id?: string;
          name_i18n?: NonNullable<Json>;
          updated_at?: string;
          us_big9?: boolean;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          app_version: string | null;
          created_at: string;
          event: string;
          household_id: string | null;
          id: string;
          occurred_at: string;
          platform: string | null;
          props: NonNullable<Json>;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          app_version?: string | null;
          created_at?: string;
          event: string;
          household_id?: string | null;
          id?: string;
          occurred_at: string;
          platform?: string | null;
          props?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          app_version?: string | null;
          created_at?: string;
          event?: string;
          household_id?: string | null;
          id?: string;
          occurred_at?: string;
          platform?: string | null;
          props?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          at: string;
          created_at: string;
          diff: NonNullable<Json>;
          entity: string;
          entity_id: string | null;
          household_id: string | null;
          id: string;
          ip_hash: string | null;
          updated_at: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          at?: string;
          created_at?: string;
          diff?: NonNullable<Json>;
          entity: string;
          entity_id?: string | null;
          household_id?: string | null;
          id?: string;
          ip_hash?: string | null;
          updated_at?: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          at?: string;
          created_at?: string;
          diff?: NonNullable<Json>;
          entity?: string;
          entity_id?: string | null;
          household_id?: string | null;
          id?: string;
          ip_hash?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_user_id_fkey';
            columns: ['actor_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_categories: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name_i18n: NonNullable<Json>;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name_i18n: NonNullable<Json>;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name_i18n?: NonNullable<Json>;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      budget_profiles: {
        Row: {
          category_split: NonNullable<Json>;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          household_id: string;
          id: string;
          is_active: boolean;
          monthly_amount_minor: number;
          strictness: string;
          updated_at: string;
        };
        Insert: {
          category_split?: NonNullable<Json>;
          created_at?: string;
          currency: string;
          deleted_at?: string | null;
          household_id: string;
          id?: string;
          is_active?: boolean;
          monthly_amount_minor: number;
          strictness?: string;
          updated_at?: string;
        };
        Update: {
          category_split?: NonNullable<Json>;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          household_id?: string;
          id?: string;
          is_active?: boolean;
          monthly_amount_minor?: number;
          strictness?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_profiles_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      consent_versions: {
        Row: {
          created_at: string;
          current_version: string;
          id: string;
          kind: string;
          material: boolean;
          published_at: string;
          text_hash: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_version: string;
          id?: string;
          kind: string;
          material?: boolean;
          published_at?: string;
          text_hash: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_version?: string;
          id?: string;
          kind?: string;
          material?: boolean;
          published_at?: string;
          text_hash?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      consents: {
        Row: {
          created_at: string;
          granted_at: string;
          household_id: string | null;
          id: string;
          kind: string;
          updated_at: string;
          user_id: string;
          version: string;
          withdrawn_at: string | null;
        };
        Insert: {
          created_at?: string;
          granted_at?: string;
          household_id?: string | null;
          id?: string;
          kind: string;
          updated_at?: string;
          user_id: string;
          version: string;
          withdrawn_at?: string | null;
        };
        Update: {
          created_at?: string;
          granted_at?: string;
          household_id?: string | null;
          id?: string;
          kind?: string;
          updated_at?: string;
          user_id?: string;
          version?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'consents_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'consents_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      devices: {
        Row: {
          app_version: string;
          created_at: string;
          id: string;
          last_seen_at: string;
          onesignal_subscription_id: string | null;
          platform: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          app_version: string;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          onesignal_subscription_id?: string | null;
          platform: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          app_version?: string;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          onesignal_subscription_id?: string | null;
          platform?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      family_members: {
        Row: {
          activity_level: Database['public']['Enums']['activity_level'];
          avatar_path: string | null;
          blood_group: Database['public']['Enums']['blood_group'];
          created_at: string;
          date_of_birth: string | null;
          deleted_at: string | null;
          height_cm: number | null;
          household_id: string;
          id: string;
          life_stage: Database['public']['Enums']['life_stage'];
          linked_user_id: string | null;
          name: string;
          sex_at_birth: Database['public']['Enums']['sex_at_birth'];
          sleep_schedule: NonNullable<Json>;
          sort_order: number;
          special_modules: Database['public']['Enums']['special_module'][];
          updated_at: string;
          weight_kg: number | null;
          work_schedule: NonNullable<Json>;
        };
        Insert: {
          activity_level?: Database['public']['Enums']['activity_level'];
          avatar_path?: string | null;
          blood_group?: Database['public']['Enums']['blood_group'];
          created_at?: string;
          date_of_birth?: string | null;
          deleted_at?: string | null;
          height_cm?: number | null;
          household_id: string;
          id?: string;
          life_stage?: Database['public']['Enums']['life_stage'];
          linked_user_id?: string | null;
          name: string;
          sex_at_birth?: Database['public']['Enums']['sex_at_birth'];
          sleep_schedule?: NonNullable<Json>;
          sort_order?: number;
          special_modules?: Database['public']['Enums']['special_module'][];
          updated_at?: string;
          weight_kg?: number | null;
          work_schedule?: NonNullable<Json>;
        };
        Update: {
          activity_level?: Database['public']['Enums']['activity_level'];
          avatar_path?: string | null;
          blood_group?: Database['public']['Enums']['blood_group'];
          created_at?: string;
          date_of_birth?: string | null;
          deleted_at?: string | null;
          height_cm?: number | null;
          household_id?: string;
          id?: string;
          life_stage?: Database['public']['Enums']['life_stage'];
          linked_user_id?: string | null;
          name?: string;
          sex_at_birth?: Database['public']['Enums']['sex_at_birth'];
          sleep_schedule?: NonNullable<Json>;
          sort_order?: number;
          special_modules?: Database['public']['Enums']['special_module'][];
          updated_at?: string;
          weight_kg?: number | null;
          work_schedule?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'family_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'family_members_linked_user_id_fkey';
            columns: ['linked_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      feature_flags: {
        Row: {
          created_at: string;
          description: string | null;
          enabled: boolean;
          id: string;
          key: string;
          rules: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          key: string;
          rules?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          key?: string;
          rules?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [];
      };
      foods_in_narrations: {
        Row: {
          context: string;
          created_at: string;
          food_label: string;
          id: string;
          ingredient_id: string | null;
          islamic_source_id: string;
          updated_at: string;
        };
        Insert: {
          context: string;
          created_at?: string;
          food_label: string;
          id?: string;
          ingredient_id?: string | null;
          islamic_source_id: string;
          updated_at?: string;
        };
        Update: {
          context?: string;
          created_at?: string;
          food_label?: string;
          id?: string;
          ingredient_id?: string | null;
          islamic_source_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'foods_in_narrations_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'foods_in_narrations_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'citable_islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'foods_in_narrations_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'foods_in_narrations_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources_public';
            referencedColumns: ['id'];
          },
        ];
      };
      hadith_references: {
        Row: {
          also_in: NonNullable<Json>;
          arabic_text: string;
          book: string | null;
          collection: string;
          created_at: string;
          grade: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by: string | null;
          id: string;
          narrator: string | null;
          number: string;
          numbering_scheme: string;
          tradition: Database['public']['Enums']['source_tradition'];
          translation_i18n: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          also_in?: NonNullable<Json>;
          arabic_text: string;
          book?: string | null;
          collection: string;
          created_at?: string;
          grade?: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by?: string | null;
          id?: string;
          narrator?: string | null;
          number: string;
          numbering_scheme?: string;
          tradition?: Database['public']['Enums']['source_tradition'];
          translation_i18n: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          also_in?: NonNullable<Json>;
          arabic_text?: string;
          book?: string | null;
          collection?: string;
          created_at?: string;
          grade?: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by?: string | null;
          id?: string;
          narrator?: string | null;
          number?: string;
          numbering_scheme?: string;
          tradition?: Database['public']['Enums']['source_tradition'];
          translation_i18n?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [];
      };
      household_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          household_id: string;
          id: string;
          invited_by: string;
          revoked_at: string | null;
          role: Database['public']['Enums']['household_role'];
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          household_id: string;
          id?: string;
          invited_by: string;
          revoked_at?: string | null;
          role: Database['public']['Enums']['household_role'];
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          household_id?: string;
          id?: string;
          invited_by?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['household_role'];
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_invitations_accepted_by_fkey';
            columns: ['accepted_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_invitations_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_invitations_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      household_members: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          household_id: string;
          id: string;
          invited_by: string | null;
          role: Database['public']['Enums']['household_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          household_id: string;
          id?: string;
          invited_by?: string | null;
          role: Database['public']['Enums']['household_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          household_id?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['household_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      households: {
        Row: {
          city: string | null;
          country_code: string;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          family_size: number;
          id: string;
          name: string;
          owner_user_id: string;
          region: string | null;
          region_id: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          country_code?: string;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          family_size?: number;
          id?: string;
          name: string;
          owner_user_id: string;
          region?: string | null;
          region_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          city?: string | null;
          country_code?: string;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          family_size?: number;
          id?: string;
          name?: string;
          owner_user_id?: string;
          region?: string | null;
          region_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'households_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'households_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      idempotency_keys: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          key: string;
          request_hash: string;
          response_body: Json | null;
          response_code: number | null;
          scope: string;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          key: string;
          request_hash: string;
          response_body?: Json | null;
          response_code?: number | null;
          scope: string;
          status: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          key?: string;
          request_hash?: string;
          response_body?: Json | null;
          response_code?: number | null;
          scope?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'idempotency_keys_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      imam_narrations: {
        Row: {
          also_in: NonNullable<Json>;
          arabic_text: string;
          chapter: string | null;
          collection: string;
          created_at: string;
          edition: string | null;
          grade: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by: string | null;
          id: string;
          imam: string;
          number: string | null;
          page: string | null;
          translation_i18n: NonNullable<Json>;
          updated_at: string;
          volume: string | null;
        };
        Insert: {
          also_in?: NonNullable<Json>;
          arabic_text: string;
          chapter?: string | null;
          collection: string;
          created_at?: string;
          edition?: string | null;
          grade?: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by?: string | null;
          id?: string;
          imam: string;
          number?: string | null;
          page?: string | null;
          translation_i18n: NonNullable<Json>;
          updated_at?: string;
          volume?: string | null;
        };
        Update: {
          also_in?: NonNullable<Json>;
          arabic_text?: string;
          chapter?: string | null;
          collection?: string;
          created_at?: string;
          edition?: string | null;
          grade?: Database['public']['Enums']['evidence_grade_hadith'];
          graded_by?: string | null;
          id?: string;
          imam?: string;
          number?: string | null;
          page?: string | null;
          translation_i18n?: NonNullable<Json>;
          updated_at?: string;
          volume?: string | null;
        };
        Relationships: [];
      };
      ingredient_allergens: {
        Row: {
          allergen_id: string;
          created_at: string;
          id: string;
          ingredient_id: string;
          updated_at: string;
        };
        Insert: {
          allergen_id: string;
          created_at?: string;
          id?: string;
          ingredient_id: string;
          updated_at?: string;
        };
        Update: {
          allergen_id?: string;
          created_at?: string;
          id?: string;
          ingredient_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_allergens_allergen_id_fkey';
            columns: ['allergen_id'];
            isOneToOne: false;
            referencedRelation: 'allergens';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingredient_allergens_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredients: {
        Row: {
          b12_mcg: number | null;
          budget_category_id: string;
          calcium_mg: number | null;
          carbs_g: number | null;
          category: string;
          color: string | null;
          created_at: string;
          default_unit: string;
          fat_g: number | null;
          fdc_id: number | null;
          fiber_g: number | null;
          folate_mcg: number | null;
          grams_per_unit: number | null;
          halal_status: string;
          id: string;
          iron_mg: number | null;
          is_active: boolean;
          is_sunnah_food: boolean;
          kcal: number | null;
          name: string;
          name_i18n: NonNullable<Json>;
          omega3_g: number | null;
          potassium_mg: number | null;
          protein_g: number | null;
          sat_fat_g: number | null;
          sodium_mg: number | null;
          sugar_g: number | null;
          textures: Database['public']['Enums']['texture'][];
          updated_at: string;
          vitamin_a_mcg: number | null;
          vitamin_c_mg: number | null;
          vitamin_d_mcg: number | null;
          zinc_mg: number | null;
        };
        Insert: {
          b12_mcg?: number | null;
          budget_category_id: string;
          calcium_mg?: number | null;
          carbs_g?: number | null;
          category: string;
          color?: string | null;
          created_at?: string;
          default_unit?: string;
          fat_g?: number | null;
          fdc_id?: number | null;
          fiber_g?: number | null;
          folate_mcg?: number | null;
          grams_per_unit?: number | null;
          halal_status?: string;
          id?: string;
          iron_mg?: number | null;
          is_active?: boolean;
          is_sunnah_food?: boolean;
          kcal?: number | null;
          name: string;
          name_i18n?: NonNullable<Json>;
          omega3_g?: number | null;
          potassium_mg?: number | null;
          protein_g?: number | null;
          sat_fat_g?: number | null;
          sodium_mg?: number | null;
          sugar_g?: number | null;
          textures?: Database['public']['Enums']['texture'][];
          updated_at?: string;
          vitamin_a_mcg?: number | null;
          vitamin_c_mg?: number | null;
          vitamin_d_mcg?: number | null;
          zinc_mg?: number | null;
        };
        Update: {
          b12_mcg?: number | null;
          budget_category_id?: string;
          calcium_mg?: number | null;
          carbs_g?: number | null;
          category?: string;
          color?: string | null;
          created_at?: string;
          default_unit?: string;
          fat_g?: number | null;
          fdc_id?: number | null;
          fiber_g?: number | null;
          folate_mcg?: number | null;
          grams_per_unit?: number | null;
          halal_status?: string;
          id?: string;
          iron_mg?: number | null;
          is_active?: boolean;
          is_sunnah_food?: boolean;
          kcal?: number | null;
          name?: string;
          name_i18n?: NonNullable<Json>;
          omega3_g?: number | null;
          potassium_mg?: number | null;
          protein_g?: number | null;
          sat_fat_g?: number | null;
          sodium_mg?: number | null;
          sugar_g?: number | null;
          textures?: Database['public']['Enums']['texture'][];
          updated_at?: string;
          vitamin_a_mcg?: number | null;
          vitamin_c_mg?: number | null;
          vitamin_d_mcg?: number | null;
          zinc_mg?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredients_budget_category_id_fkey';
            columns: ['budget_category_id'];
            isOneToOne: false;
            referencedRelation: 'budget_categories';
            referencedColumns: ['id'];
          },
        ];
      };
      islamic_sources: {
        Row: {
          approvals_count: number;
          citation_text: string;
          code: string;
          created_at: string;
          embedding: string | null;
          id: string;
          kind: Database['public']['Enums']['source_kind'];
          ref_id: string | null;
          retracted_at: string | null;
          retraction_reason: string | null;
          search_tsv: unknown;
          topic_tags: string[];
          tradition: Database['public']['Enums']['source_tradition'];
          updated_at: string;
          verification_status: Database['public']['Enums']['verification_status'];
        };
        Insert: {
          approvals_count?: number;
          citation_text: string;
          code: string;
          created_at?: string;
          embedding?: string | null;
          id?: string;
          kind: Database['public']['Enums']['source_kind'];
          ref_id?: string | null;
          retracted_at?: string | null;
          retraction_reason?: string | null;
          search_tsv?: never;
          topic_tags?: string[];
          tradition: Database['public']['Enums']['source_tradition'];
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
        };
        Update: {
          approvals_count?: number;
          citation_text?: string;
          code?: string;
          created_at?: string;
          embedding?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['source_kind'];
          ref_id?: string | null;
          retracted_at?: string | null;
          retraction_reason?: string | null;
          search_tsv?: never;
          topic_tags?: string[];
          tradition?: Database['public']['Enums']['source_tradition'];
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
        };
        Relationships: [];
      };
      prompt_templates: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_active: boolean;
          key: string;
          updated_at: string;
          variables: NonNullable<Json>;
          version: number;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          updated_at?: string;
          variables?: NonNullable<Json>;
          version: number;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          updated_at?: string;
          variables?: NonNullable<Json>;
          version?: number;
        };
        Relationships: [];
      };
      quran_references: {
        Row: {
          arabic_text: string;
          ayah_end: number;
          ayah_start: number;
          created_at: string;
          id: string;
          surah: number;
          topic_tags: string[];
          translation_i18n: NonNullable<Json>;
          translator: string;
          updated_at: string;
        };
        Insert: {
          arabic_text: string;
          ayah_end: number;
          ayah_start: number;
          created_at?: string;
          id?: string;
          surah: number;
          topic_tags?: string[];
          translation_i18n: NonNullable<Json>;
          translator: string;
          updated_at?: string;
        };
        Update: {
          arabic_text?: string;
          ayah_end?: number;
          ayah_start?: number;
          created_at?: string;
          id?: string;
          surah?: number;
          topic_tags?: string[];
          translation_i18n?: NonNullable<Json>;
          translator?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      quran_text: {
        Row: {
          ayah: number;
          created_at: string;
          edition: string;
          id: string;
          source_sha256: string;
          surah: number;
          text: string;
          updated_at: string;
        };
        Insert: {
          ayah: number;
          created_at?: string;
          edition: string;
          id?: string;
          source_sha256: string;
          surah: number;
          text: string;
          updated_at?: string;
        };
        Update: {
          ayah?: number;
          created_at?: string;
          edition?: string;
          id?: string;
          source_sha256?: string;
          surah?: number;
          text?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: {
          bucket_key: string;
          count: number;
          created_at: string;
          updated_at: string;
          window_start: string;
        };
        Insert: {
          bucket_key: string;
          count: number;
          created_at?: string;
          updated_at?: string;
          window_start: string;
        };
        Update: {
          bucket_key?: string;
          count?: number;
          created_at?: string;
          updated_at?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      recommendation_evidence: {
        Row: {
          created_at: string;
          id: string;
          islamic_source_id: string | null;
          recommendation_id: string;
          relationship: string;
          scientific_evidence_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          islamic_source_id?: string | null;
          recommendation_id: string;
          relationship: string;
          scientific_evidence_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          islamic_source_id?: string | null;
          recommendation_id?: string;
          relationship?: string;
          scientific_evidence_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recommendation_evidence_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'citable_islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recommendation_evidence_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recommendation_evidence_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recommendation_evidence_recommendation_id_fkey';
            columns: ['recommendation_id'];
            isOneToOne: false;
            referencedRelation: 'recommendations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recommendation_evidence_scientific_evidence_id_fkey';
            columns: ['scientific_evidence_id'];
            isOneToOne: false;
            referencedRelation: 'scientific_evidence';
            referencedColumns: ['id'];
          },
        ];
      };
      recommendations: {
        Row: {
          applies_to: NonNullable<Json>;
          code: string;
          contraindications: NonNullable<Json>;
          created_at: string;
          id: string;
          practical_text_i18n: NonNullable<Json>;
          review_status: Database['public']['Enums']['verification_status'];
          science_only: boolean;
          title_i18n: NonNullable<Json>;
          tradition_scope: Database['public']['Enums']['source_tradition'][];
          updated_at: string;
          version: number;
        };
        Insert: {
          applies_to?: NonNullable<Json>;
          code: string;
          contraindications?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          practical_text_i18n: NonNullable<Json>;
          review_status?: Database['public']['Enums']['verification_status'];
          science_only?: boolean;
          title_i18n: NonNullable<Json>;
          tradition_scope?: Database['public']['Enums']['source_tradition'][];
          updated_at?: string;
          version?: number;
        };
        Update: {
          applies_to?: NonNullable<Json>;
          code?: string;
          contraindications?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          practical_text_i18n?: NonNullable<Json>;
          review_status?: Database['public']['Enums']['verification_status'];
          science_only?: boolean;
          title_i18n?: NonNullable<Json>;
          tradition_scope?: Database['public']['Enums']['source_tradition'][];
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      regions: {
        Row: {
          climate_zone: string;
          country_code: string;
          created_at: string;
          default_currency: string;
          id: string;
          name: string;
          region_code: string;
          updated_at: string;
        };
        Insert: {
          climate_zone: string;
          country_code: string;
          created_at?: string;
          default_currency: string;
          id?: string;
          name: string;
          region_code: string;
          updated_at?: string;
        };
        Update: {
          climate_zone?: string;
          country_code?: string;
          created_at?: string;
          default_currency?: string;
          id?: string;
          name?: string;
          region_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      scholar_reviewers: {
        Row: {
          agreement_signed_on: string | null;
          approved_by: string | null;
          competencies: string[];
          created_at: string;
          credentials: string;
          full_name: string;
          id: string;
          institution: string | null;
          is_active: boolean;
          languages: string[];
          traditions: Database['public']['Enums']['source_tradition'][];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          agreement_signed_on?: string | null;
          approved_by?: string | null;
          competencies?: string[];
          created_at?: string;
          credentials: string;
          full_name: string;
          id?: string;
          institution?: string | null;
          is_active?: boolean;
          languages?: string[];
          traditions: Database['public']['Enums']['source_tradition'][];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          agreement_signed_on?: string | null;
          approved_by?: string | null;
          competencies?: string[];
          created_at?: string;
          credentials?: string;
          full_name?: string;
          id?: string;
          institution?: string | null;
          is_active?: boolean;
          languages?: string[];
          traditions?: Database['public']['Enums']['source_tradition'][];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'scholar_reviewers_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scholar_reviewers_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      scholarly_notes: {
        Row: {
          author_credentials: string;
          author_name: string;
          body_i18n: NonNullable<Json>;
          created_at: string;
          id: string;
          title_i18n: NonNullable<Json>;
          tradition: Database['public']['Enums']['source_tradition'];
          updated_at: string;
        };
        Insert: {
          author_credentials: string;
          author_name: string;
          body_i18n: NonNullable<Json>;
          created_at?: string;
          id?: string;
          title_i18n: NonNullable<Json>;
          tradition?: Database['public']['Enums']['source_tradition'];
          updated_at?: string;
        };
        Update: {
          author_credentials?: string;
          author_name?: string;
          body_i18n?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          title_i18n?: NonNullable<Json>;
          tradition?: Database['public']['Enums']['source_tradition'];
          updated_at?: string;
        };
        Relationships: [];
      };
      scientific_evidence: {
        Row: {
          citation: string;
          code: string;
          created_at: string;
          doi: string | null;
          grade: Database['public']['Enums']['evidence_grade_science'];
          id: string;
          pmid: string | null;
          population: string | null;
          retracted_at: string | null;
          reviewed_by: string | null;
          reviewed_on: string | null;
          study_type: string;
          summary: string;
          summary_i18n: NonNullable<Json>;
          title: string;
          updated_at: string;
        };
        Insert: {
          citation: string;
          code: string;
          created_at?: string;
          doi?: string | null;
          grade: Database['public']['Enums']['evidence_grade_science'];
          id?: string;
          pmid?: string | null;
          population?: string | null;
          retracted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_on?: string | null;
          study_type: string;
          summary: string;
          summary_i18n?: NonNullable<Json>;
          title: string;
          updated_at?: string;
        };
        Update: {
          citation?: string;
          code?: string;
          created_at?: string;
          doi?: string | null;
          grade?: Database['public']['Enums']['evidence_grade_science'];
          id?: string;
          pmid?: string | null;
          population?: string | null;
          retracted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_on?: string | null;
          study_type?: string;
          summary?: string;
          summary_i18n?: NonNullable<Json>;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      source_verifications: {
        Row: {
          action: string | null;
          checklist: NonNullable<Json>;
          created_at: string;
          id: string;
          islamic_source_id: string;
          method: string;
          notes: string | null;
          reviewed_on: string;
          reviewer_credentials: string;
          reviewer_id: string | null;
          reviewer_name: string;
          round: number;
          status: Database['public']['Enums']['verification_status'];
          updated_at: string;
        };
        Insert: {
          action?: string | null;
          checklist?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          islamic_source_id: string;
          method: string;
          notes?: string | null;
          reviewed_on?: string;
          reviewer_credentials: string;
          reviewer_id?: string | null;
          reviewer_name: string;
          round?: number;
          status: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Update: {
          action?: string | null;
          checklist?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          islamic_source_id?: string;
          method?: string;
          notes?: string | null;
          reviewed_on?: string;
          reviewer_credentials?: string;
          reviewer_id?: string | null;
          reviewer_name?: string;
          round?: number;
          status?: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'source_verifications_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'citable_islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'source_verifications_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'source_verifications_islamic_source_id_fkey';
            columns: ['islamic_source_id'];
            isOneToOne: false;
            referencedRelation: 'islamic_sources_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'source_verifications_reviewer_id_fkey';
            columns: ['reviewer_id'];
            isOneToOne: false;
            referencedRelation: 'scholar_reviewers';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          last_event_at: string | null;
          last_event_id: string | null;
          product_id: string;
          raw_event: NonNullable<Json>;
          rc_app_user_id: string;
          status: Database['public']['Enums']['subscription_status'];
          store: string;
          tier: Database['public']['Enums']['subscription_tier'];
          updated_at: string;
          user_id: string;
          will_renew: boolean;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          last_event_at?: string | null;
          last_event_id?: string | null;
          product_id: string;
          raw_event?: NonNullable<Json>;
          rc_app_user_id: string;
          status: Database['public']['Enums']['subscription_status'];
          store: string;
          tier?: Database['public']['Enums']['subscription_tier'];
          updated_at?: string;
          user_id: string;
          will_renew?: boolean;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          last_event_at?: string | null;
          last_event_id?: string | null;
          product_id?: string;
          raw_event?: NonNullable<Json>;
          rc_app_user_id?: string;
          status?: Database['public']['Enums']['subscription_status'];
          store?: string;
          tier?: Database['public']['Enums']['subscription_tier'];
          updated_at?: string;
          user_id?: string;
          will_renew?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          age_attested_at: string | null;
          analytics_opt_out: boolean;
          avatar_path: string | null;
          country_code: string | null;
          created_at: string;
          deleted_at: string | null;
          deletion_scheduled_for: string | null;
          display_name: string;
          email: string | null;
          id: string;
          is_internal: boolean;
          locale: string;
          onboarding_completed_at: string | null;
          processing_restricted: boolean;
          timezone: string;
          tradition_preference: Database['public']['Enums']['source_tradition'];
          units: string;
          updated_at: string;
        };
        Insert: {
          age_attested_at?: string | null;
          analytics_opt_out?: boolean;
          avatar_path?: string | null;
          country_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deletion_scheduled_for?: string | null;
          display_name?: string;
          email?: string | null;
          id: string;
          is_internal?: boolean;
          locale?: string;
          onboarding_completed_at?: string | null;
          processing_restricted?: boolean;
          timezone?: string;
          tradition_preference?: Database['public']['Enums']['source_tradition'];
          units?: string;
          updated_at?: string;
        };
        Update: {
          age_attested_at?: string | null;
          analytics_opt_out?: boolean;
          avatar_path?: string | null;
          country_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deletion_scheduled_for?: string | null;
          display_name?: string;
          email?: string | null;
          id?: string;
          is_internal?: boolean;
          locale?: string;
          onboarding_completed_at?: string | null;
          processing_restricted?: boolean;
          timezone?: string;
          tradition_preference?: Database['public']['Enums']['source_tradition'];
          units?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      citable_islamic_sources: {
        Row: {
          approvals_count: number | null;
          citation_text: string | null;
          code: string | null;
          created_at: string | null;
          embedding: string | null;
          id: string | null;
          kind: Database['public']['Enums']['source_kind'] | null;
          ref_id: string | null;
          retracted_at: string | null;
          retraction_reason: string | null;
          search_tsv: unknown;
          topic_tags: string[] | null;
          tradition: Database['public']['Enums']['source_tradition'] | null;
          updated_at: string | null;
          verification_status: Database['public']['Enums']['verification_status'] | null;
        };
        Insert: {
          approvals_count?: number | null;
          citation_text?: string | null;
          code?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string | null;
          kind?: Database['public']['Enums']['source_kind'] | null;
          ref_id?: string | null;
          retracted_at?: string | null;
          retraction_reason?: string | null;
          search_tsv?: unknown;
          topic_tags?: string[] | null;
          tradition?: Database['public']['Enums']['source_tradition'] | null;
          updated_at?: string | null;
          verification_status?: Database['public']['Enums']['verification_status'] | null;
        };
        Update: {
          approvals_count?: number | null;
          citation_text?: string | null;
          code?: string | null;
          created_at?: string | null;
          embedding?: string | null;
          id?: string | null;
          kind?: Database['public']['Enums']['source_kind'] | null;
          ref_id?: string | null;
          retracted_at?: string | null;
          retraction_reason?: string | null;
          search_tsv?: unknown;
          topic_tags?: string[] | null;
          tradition?: Database['public']['Enums']['source_tradition'] | null;
          updated_at?: string | null;
          verification_status?: Database['public']['Enums']['verification_status'] | null;
        };
        Relationships: [];
      };
      islamic_sources_public: {
        Row: {
          citation_text: string | null;
          code: string | null;
          id: string | null;
          kind: Database['public']['Enums']['source_kind'] | null;
          ref_id: string | null;
          topic_tags: string[] | null;
          tradition: Database['public']['Enums']['source_tradition'] | null;
          updated_at: string | null;
        };
        Insert: {
          citation_text?: string | null;
          code?: string | null;
          id?: string | null;
          kind?: Database['public']['Enums']['source_kind'] | null;
          ref_id?: string | null;
          topic_tags?: string[] | null;
          tradition?: Database['public']['Enums']['source_tradition'] | null;
          updated_at?: string | null;
        };
        Update: {
          citation_text?: string | null;
          code?: string | null;
          id?: string | null;
          kind?: Database['public']['Enums']['source_kind'] | null;
          ref_id?: string | null;
          topic_tags?: string[] | null;
          tradition?: Database['public']['Enums']['source_tradition'] | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      v_knowledge_status: {
        Row: {
          item: string | null;
          median_days_in_review: number | null;
          n: number | null;
          retracted_90d: number | null;
          status: string | null;
          tradition: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_household_invitation: {
        Args: { p_invitation_id: string; p_user_id: string };
        Returns: undefined;
      };
      age_in_months: { Args: { p_dob: string; p_on?: string }; Returns: number };
      can_author_plans: { Args: { p_household_id: string }; Returns: boolean };
      can_edit_household: { Args: { p_household_id: string }; Returns: boolean };
      compute_bmi: {
        Args: { p_height_cm: number; p_weight_kg: number };
        Returns: number;
      };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: {
          allowed: boolean;
          remaining: number;
          reset_at: string;
        }[];
      };
      evaluate_feature_flags: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      has_active_consent: {
        Args: { p_household?: string; p_kind: string; p_user: string };
        Returns: boolean;
      };
      has_content_role: { Args: { p_roles: string[] }; Returns: boolean };
      has_household_role: {
        Args: {
          p_household_id: string;
          p_roles: Database['public']['Enums']['household_role'][];
        };
        Returns: boolean;
      };
      has_premium: { Args: { p_user_id: string }; Returns: boolean };
      household_has_premium: {
        Args: { p_household_id: string };
        Returns: boolean;
      };
      household_role_of: {
        Args: { p_household_id: string };
        Returns: Database['public']['Enums']['household_role'];
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_household_member: {
        Args: { p_household_id: string };
        Returns: boolean;
      };
      is_linked_member: {
        Args: { p_family_member_id: string };
        Returns: boolean;
      };
      is_minor: { Args: { p_dob: string; p_on?: string }; Returns: boolean };
      life_stage_for_dob: {
        Args: { p_dob: string; p_on?: string };
        Returns: Database['public']['Enums']['life_stage'];
      };
      my_household_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean };
      soft_delete: {
        Args: { p_id: string; p_table: string };
        Returns: undefined;
      };
      transfer_household_ownership: {
        Args: { p_household_id: string; p_new_owner: string };
        Returns: undefined;
      };
    };
    Enums: {
      acceptance_score:
        '0_refused' | '1_tolerated' | '2_touched' | '3_tasted' | '4_ate_some' | '5_ate_well';
      activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
      blood_group: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'unknown';
      chat_role: 'user' | 'assistant' | 'system' | 'tool';
      evidence_grade_hadith:
        | 'sahih'
        | 'hasan'
        | 'daif'
        | 'mawdu'
        | 'sahih_shia'
        | 'muwaththaq'
        | 'hasan_shia'
        | 'daif_shia'
        | 'ungraded';
      evidence_grade_science: 'high' | 'moderate' | 'low' | 'very_low' | 'expert_opinion';
      exposure_stage:
        | 'tolerate_on_table'
        | 'look'
        | 'touch'
        | 'smell'
        | 'lick'
        | 'taste'
        | 'chew_spit'
        | 'eat_small'
        | 'eat_portion';
      fast_kind:
        | 'ramadan'
        | 'sunnah_monday_thursday'
        | 'ayyam_al_bid'
        | 'arafah'
        | 'ashura'
        | 'qada'
        | 'nafl'
        | 'intermittent';
      goal_type:
        | 'weight_loss'
        | 'weight_gain'
        | 'maintain'
        | 'child_growth'
        | 'energy'
        | 'digestive_health'
        | 'pregnancy_support'
        | 'breastfeeding_support'
        | 'blood_sugar'
        | 'heart_health';
      household_role: 'owner' | 'caregiver' | 'viewer' | 'coach';
      life_stage: 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'older_adult';
      meal_status: 'planned' | 'eaten' | 'partly_eaten' | 'skipped' | 'swapped';
      meal_type: 'suhoor' | 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'iftar';
      notification_channel: 'push' | 'in_app' | 'email';
      plan_kind: 'standard' | 'ramadan' | 'growth' | 'weight_management' | 'custom';
      plan_status: 'draft' | 'generating' | 'active' | 'completed' | 'archived' | 'failed';
      price_source: 'seed' | 'user_report' | 'admin' | 'partner_feed';
      severity: 'mild' | 'moderate' | 'severe' | 'anaphylactic';
      sex_at_birth: 'female' | 'male' | 'unspecified';
      source_kind: 'quran' | 'hadith' | 'imam_narration' | 'scholarly';
      source_tradition: 'shared' | 'sunni' | 'shia';
      special_module: 'pregnancy' | 'breastfeeding' | 'autism' | 'adhd' | 'picky_eater';
      subscription_status:
        'active' | 'in_grace' | 'in_billing_retry' | 'cancelled' | 'expired' | 'paused';
      subscription_tier: 'free' | 'premium';
      texture:
        'smooth' | 'soft' | 'crunchy' | 'chewy' | 'crispy' | 'mixed' | 'lumpy' | 'wet' | 'dry';
      verification_status: 'unverified' | 'in_review' | 'verified' | 'rejected';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      acceptance_score: [
        '0_refused',
        '1_tolerated',
        '2_touched',
        '3_tasted',
        '4_ate_some',
        '5_ate_well',
      ],
      activity_level: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
      blood_group: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'],
      chat_role: ['user', 'assistant', 'system', 'tool'],
      evidence_grade_hadith: [
        'sahih',
        'hasan',
        'daif',
        'mawdu',
        'sahih_shia',
        'muwaththaq',
        'hasan_shia',
        'daif_shia',
        'ungraded',
      ],
      evidence_grade_science: ['high', 'moderate', 'low', 'very_low', 'expert_opinion'],
      exposure_stage: [
        'tolerate_on_table',
        'look',
        'touch',
        'smell',
        'lick',
        'taste',
        'chew_spit',
        'eat_small',
        'eat_portion',
      ],
      fast_kind: [
        'ramadan',
        'sunnah_monday_thursday',
        'ayyam_al_bid',
        'arafah',
        'ashura',
        'qada',
        'nafl',
        'intermittent',
      ],
      goal_type: [
        'weight_loss',
        'weight_gain',
        'maintain',
        'child_growth',
        'energy',
        'digestive_health',
        'pregnancy_support',
        'breastfeeding_support',
        'blood_sugar',
        'heart_health',
      ],
      household_role: ['owner', 'caregiver', 'viewer', 'coach'],
      life_stage: ['infant', 'toddler', 'child', 'teen', 'adult', 'older_adult'],
      meal_status: ['planned', 'eaten', 'partly_eaten', 'skipped', 'swapped'],
      meal_type: ['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar'],
      notification_channel: ['push', 'in_app', 'email'],
      plan_kind: ['standard', 'ramadan', 'growth', 'weight_management', 'custom'],
      plan_status: ['draft', 'generating', 'active', 'completed', 'archived', 'failed'],
      price_source: ['seed', 'user_report', 'admin', 'partner_feed'],
      severity: ['mild', 'moderate', 'severe', 'anaphylactic'],
      sex_at_birth: ['female', 'male', 'unspecified'],
      source_kind: ['quran', 'hadith', 'imam_narration', 'scholarly'],
      source_tradition: ['shared', 'sunni', 'shia'],
      special_module: ['pregnancy', 'breastfeeding', 'autism', 'adhd', 'picky_eater'],
      subscription_status: [
        'active',
        'in_grace',
        'in_billing_retry',
        'cancelled',
        'expired',
        'paused',
      ],
      subscription_tier: ['free', 'premium'],
      texture: ['smooth', 'soft', 'crunchy', 'chewy', 'crispy', 'mixed', 'lumpy', 'wet', 'dry'],
      verification_status: ['unverified', 'in_review', 'verified', 'rejected'],
    },
  },
} as const;
