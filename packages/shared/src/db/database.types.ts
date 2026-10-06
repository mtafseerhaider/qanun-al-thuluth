export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '16.4';
  };
  public: {
    Tables: {
      ai_assessments: {
        Row: {
          created_at: string;
          created_by_user_id: string | null;
          energy_targets: NonNullable<Json>;
          family_member_id: string | null;
          household_id: string;
          hydration_targets: NonNullable<Json>;
          id: string;
          input_snapshot: NonNullable<Json>;
          kind: string;
          macro_targets: NonNullable<Json>;
          model: string | null;
          model_route: string;
          prompt_version: string;
          risk_flags: string[];
          summary: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string | null;
          energy_targets?: NonNullable<Json>;
          family_member_id?: string | null;
          household_id: string;
          hydration_targets?: NonNullable<Json>;
          id?: string;
          input_snapshot?: NonNullable<Json>;
          kind: string;
          macro_targets?: NonNullable<Json>;
          model?: string | null;
          model_route: string;
          prompt_version: string;
          risk_flags?: string[];
          summary: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string | null;
          energy_targets?: NonNullable<Json>;
          family_member_id?: string | null;
          household_id?: string;
          hydration_targets?: NonNullable<Json>;
          id?: string;
          input_snapshot?: NonNullable<Json>;
          kind?: string;
          macro_targets?: NonNullable<Json>;
          model?: string | null;
          model_route?: string;
          prompt_version?: string;
          risk_flags?: string[];
          summary?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_assessments_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_assessments_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'ai_assessments_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_eval_cases: {
        Row: {
          active: boolean;
          case_key: string;
          created_at: string;
          expect: NonNullable<Json>;
          fixture: NonNullable<Json>;
          id: string;
          suite: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          case_key: string;
          created_at?: string;
          expect: NonNullable<Json>;
          fixture: NonNullable<Json>;
          id?: string;
          suite: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          case_key?: string;
          created_at?: string;
          expect?: NonNullable<Json>;
          fixture?: NonNullable<Json>;
          id?: string;
          suite?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_eval_runs: {
        Row: {
          case_id: string | null;
          created_at: string;
          git_sha: string | null;
          id: string;
          judge_score: number | null;
          metrics: NonNullable<Json>;
          model: string | null;
          output: Json | null;
          passed: boolean;
          prompt_key: string | null;
          prompt_version: number | null;
          prompt_versions: NonNullable<Json>;
          route_key: string | null;
          routes: NonNullable<Json>;
          suite: string;
          updated_at: string;
        };
        Insert: {
          case_id?: string | null;
          created_at?: string;
          git_sha?: string | null;
          id?: string;
          judge_score?: number | null;
          metrics?: NonNullable<Json>;
          model?: string | null;
          output?: Json | null;
          passed: boolean;
          prompt_key?: string | null;
          prompt_version?: number | null;
          prompt_versions?: NonNullable<Json>;
          route_key?: string | null;
          routes?: NonNullable<Json>;
          suite: string;
          updated_at?: string;
        };
        Update: {
          case_id?: string | null;
          created_at?: string;
          git_sha?: string | null;
          id?: string;
          judge_score?: number | null;
          metrics?: NonNullable<Json>;
          model?: string | null;
          output?: Json | null;
          passed?: boolean;
          prompt_key?: string | null;
          prompt_version?: number | null;
          prompt_versions?: NonNullable<Json>;
          route_key?: string | null;
          routes?: NonNullable<Json>;
          suite?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_eval_runs_case_id_fkey';
            columns: ['case_id'];
            isOneToOne: false;
            referencedRelation: 'ai_eval_cases';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_memories: {
        Row: {
          confidence: number;
          created_at: string;
          deleted_at: string | null;
          embedding: string;
          expires_at: string | null;
          fact: string;
          family_member_id: string | null;
          household_id: string;
          id: string;
          kind: string;
          source_message_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          confidence?: number;
          created_at?: string;
          deleted_at?: string | null;
          embedding: string;
          expires_at?: string | null;
          fact: string;
          family_member_id?: string | null;
          household_id: string;
          id?: string;
          kind?: string;
          source_message_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          deleted_at?: string | null;
          embedding?: string;
          expires_at?: string | null;
          fact?: string;
          family_member_id?: string | null;
          household_id?: string;
          id?: string;
          kind?: string;
          source_message_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_memories_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'ai_memories_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_memories_source_message_id_fkey';
            columns: ['source_message_id'];
            isOneToOne: false;
            referencedRelation: 'chat_messages';
            referencedColumns: ['id'];
          },
        ];
      };
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
          cache_read_tokens: number;
          cache_write_tokens: number;
          cost_usd_micros: number;
          created_at: string;
          household_id: string | null;
          id: string;
          latency_ms: number | null;
          model: string;
          prompt_key: string | null;
          prompt_version: number | null;
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
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd_micros?: number;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          latency_ms?: number | null;
          model: string;
          prompt_key?: string | null;
          prompt_version?: number | null;
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
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd_micros?: number;
          created_at?: string;
          household_id?: string | null;
          id?: string;
          latency_ms?: number | null;
          model?: string;
          prompt_key?: string | null;
          prompt_version?: number | null;
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
      allergies: {
        Row: {
          allergen_id: string;
          created_at: string;
          deleted_at: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          kind: string;
          reaction_notes: string | null;
          severity: Database['public']['Enums']['severity'];
          updated_at: string;
        };
        Insert: {
          allergen_id: string;
          created_at?: string;
          deleted_at?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          kind?: string;
          reaction_notes?: string | null;
          severity: Database['public']['Enums']['severity'];
          updated_at?: string;
        };
        Update: {
          allergen_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          kind?: string;
          reaction_notes?: string | null;
          severity?: Database['public']['Enums']['severity'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'allergies_allergen_id_fkey';
            columns: ['allergen_id'];
            isOneToOne: false;
            referencedRelation: 'allergens';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allergies_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'allergies_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      alpha_feedback: {
        Row: {
          app_version: string;
          category: string;
          client_created_at: string | null;
          created_at: string;
          device_info: NonNullable<Json>;
          household_id: string | null;
          id: string;
          locale: string | null;
          message: string;
          platform: string | null;
          screen: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          app_version: string;
          category: string;
          client_created_at?: string | null;
          created_at?: string;
          device_info?: NonNullable<Json>;
          household_id?: string | null;
          id?: string;
          locale?: string | null;
          message: string;
          platform?: string | null;
          screen?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          app_version?: string;
          category?: string;
          client_created_at?: string | null;
          created_at?: string;
          device_info?: NonNullable<Json>;
          household_id?: string | null;
          id?: string;
          locale?: string | null;
          message?: string;
          platform?: string | null;
          screen?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'alpha_feedback_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'alpha_feedback_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
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
      budget_entries: {
        Row: {
          amount_minor: number;
          budget_profile_id: string;
          category_id: string;
          created_at: string;
          currency: string;
          grocery_list_id: string | null;
          household_id: string;
          id: string;
          note: string | null;
          spent_on: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          budget_profile_id: string;
          category_id: string;
          created_at?: string;
          currency: string;
          grocery_list_id?: string | null;
          household_id: string;
          id?: string;
          note?: string | null;
          spent_on?: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          budget_profile_id?: string;
          category_id?: string;
          created_at?: string;
          currency?: string;
          grocery_list_id?: string | null;
          household_id?: string;
          id?: string;
          note?: string | null;
          spent_on?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_entries_budget_profile_id_household_id_fkey';
            columns: ['budget_profile_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'budget_profiles';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'budget_entries_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'budget_categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_entries_grocery_list_id_household_id_fkey';
            columns: ['grocery_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'grocery_lists';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'budget_entries_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
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
      chat_messages: {
        Row: {
          attachments: NonNullable<Json>;
          client_message_id: string | null;
          content: string;
          created_at: string;
          finish_reason: string | null;
          household_id: string;
          id: string;
          model: string | null;
          role: Database['public']['Enums']['chat_role'];
          safety_flags: string[];
          session_id: string;
          tokens_in: number | null;
          tokens_out: number | null;
          tool_calls: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          attachments?: NonNullable<Json>;
          client_message_id?: string | null;
          content?: string;
          created_at?: string;
          finish_reason?: string | null;
          household_id: string;
          id?: string;
          model?: string | null;
          role: Database['public']['Enums']['chat_role'];
          safety_flags?: string[];
          session_id: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          tool_calls?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          attachments?: NonNullable<Json>;
          client_message_id?: string | null;
          content?: string;
          created_at?: string;
          finish_reason?: string | null;
          household_id?: string;
          id?: string;
          model?: string | null;
          role?: Database['public']['Enums']['chat_role'];
          safety_flags?: string[];
          session_id?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          tool_calls?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_messages_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chat_messages_session_id_household_id_fkey';
            columns: ['session_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'chat_sessions';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      chat_sessions: {
        Row: {
          context_snapshot: NonNullable<Json>;
          created_at: string;
          deleted_at: string | null;
          household_id: string;
          id: string;
          last_message_at: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          context_snapshot?: NonNullable<Json>;
          created_at?: string;
          deleted_at?: string | null;
          household_id: string;
          id?: string;
          last_message_at?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          context_snapshot?: NonNullable<Json>;
          created_at?: string;
          deleted_at?: string | null;
          household_id?: string;
          id?: string;
          last_message_at?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_sessions_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chat_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
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
      daily_meal_servings: {
        Row: {
          acceptance: Database['public']['Enums']['acceptance_score'] | null;
          adaptation: string;
          adapted_meal_id: string | null;
          created_at: string;
          daily_meal_id: string;
          family_member_id: string;
          household_id: string;
          id: string;
          logged_at: string | null;
          portion_id: string | null;
          status: Database['public']['Enums']['meal_status'];
          updated_at: string;
        };
        Insert: {
          acceptance?: Database['public']['Enums']['acceptance_score'] | null;
          adaptation?: string;
          adapted_meal_id?: string | null;
          created_at?: string;
          daily_meal_id: string;
          family_member_id: string;
          household_id: string;
          id?: string;
          logged_at?: string | null;
          portion_id?: string | null;
          status?: Database['public']['Enums']['meal_status'];
          updated_at?: string;
        };
        Update: {
          acceptance?: Database['public']['Enums']['acceptance_score'] | null;
          adaptation?: string;
          adapted_meal_id?: string | null;
          created_at?: string;
          daily_meal_id?: string;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          logged_at?: string | null;
          portion_id?: string | null;
          status?: Database['public']['Enums']['meal_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_meal_servings_adapted_meal_id_fkey';
            columns: ['adapted_meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_meal_servings_daily_meal_id_household_id_fkey';
            columns: ['daily_meal_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'daily_meals';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'daily_meal_servings_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'daily_meal_servings_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_meal_servings_portion_id_fkey';
            columns: ['portion_id'];
            isOneToOne: false;
            referencedRelation: 'portions';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_meals: {
        Row: {
          batch_multiplier: number;
          created_at: string;
          household_id: string;
          id: string;
          is_lunchbox: boolean;
          meal_id: string;
          meal_plan_id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          notes: string | null;
          plan_date: string;
          scheduled_time: string | null;
          slot: number;
          source_daily_meal_id: string | null;
          swapped_from_meal_id: string | null;
          updated_at: string;
        };
        Insert: {
          batch_multiplier?: number;
          created_at?: string;
          household_id: string;
          id?: string;
          is_lunchbox?: boolean;
          meal_id: string;
          meal_plan_id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          notes?: string | null;
          plan_date: string;
          scheduled_time?: string | null;
          slot?: number;
          source_daily_meal_id?: string | null;
          swapped_from_meal_id?: string | null;
          updated_at?: string;
        };
        Update: {
          batch_multiplier?: number;
          created_at?: string;
          household_id?: string;
          id?: string;
          is_lunchbox?: boolean;
          meal_id?: string;
          meal_plan_id?: string;
          meal_type?: Database['public']['Enums']['meal_type'];
          notes?: string | null;
          plan_date?: string;
          scheduled_time?: string | null;
          slot?: number;
          source_daily_meal_id?: string | null;
          swapped_from_meal_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_meals_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_meals_meal_id_fkey';
            columns: ['meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_meals_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'daily_meals_source_fk';
            columns: ['source_daily_meal_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'daily_meals';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'daily_meals_swapped_from_meal_id_fkey';
            columns: ['swapped_from_meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
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
          lifestyle: NonNullable<Json>;
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
          lifestyle?: NonNullable<Json>;
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
          lifestyle?: NonNullable<Json>;
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
      fasting_logs: {
        Row: {
          completed: boolean;
          created_at: string;
          ended_at: string | null;
          exemption_reason: string | null;
          family_member_id: string;
          fast_date: string;
          hijri_date: string | null;
          household_id: string;
          id: string;
          is_practice_fast: boolean;
          kind: Database['public']['Enums']['fast_kind'];
          notes: string | null;
          qada_for_hijri_year: number | null;
          started_at: string | null;
          updated_at: string;
        };
        Insert: {
          completed?: boolean;
          created_at?: string;
          ended_at?: string | null;
          exemption_reason?: string | null;
          family_member_id: string;
          fast_date: string;
          hijri_date?: string | null;
          household_id: string;
          id?: string;
          is_practice_fast?: boolean;
          kind: Database['public']['Enums']['fast_kind'];
          notes?: string | null;
          qada_for_hijri_year?: number | null;
          started_at?: string | null;
          updated_at?: string;
        };
        Update: {
          completed?: boolean;
          created_at?: string;
          ended_at?: string | null;
          exemption_reason?: string | null;
          family_member_id?: string;
          fast_date?: string;
          hijri_date?: string | null;
          household_id?: string;
          id?: string;
          is_practice_fast?: boolean;
          kind?: Database['public']['Enums']['fast_kind'];
          notes?: string | null;
          qada_for_hijri_year?: number | null;
          started_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fasting_logs_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'fasting_logs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
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
      food_dislikes: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          label: string;
          reason: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          label: string;
          reason?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          label?: string;
          reason?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'food_dislikes_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'food_dislikes_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'food_dislikes_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      food_preferences: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          is_safe_food: boolean;
          label: string;
          recipe_id: string | null;
          strength: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          is_safe_food?: boolean;
          label: string;
          recipe_id?: string | null;
          strength?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          is_safe_food?: boolean;
          label?: string;
          recipe_id?: string | null;
          strength?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'food_preferences_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'food_preferences_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'food_preferences_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'food_preferences_recipe_id_fkey';
            columns: ['recipe_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id'];
          },
        ];
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
      grocery_lists: {
        Row: {
          created_at: string;
          currency: string;
          deleted_at: string | null;
          ends_on: string;
          estimated_total_minor: number;
          household_id: string;
          id: string;
          meal_plan_id: string | null;
          period: string;
          price_profile_id: string | null;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency: string;
          deleted_at?: string | null;
          ends_on: string;
          estimated_total_minor?: number;
          household_id: string;
          id?: string;
          meal_plan_id?: string | null;
          period?: string;
          price_profile_id?: string | null;
          starts_on: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          ends_on?: string;
          estimated_total_minor?: number;
          household_id?: string;
          id?: string;
          meal_plan_id?: string | null;
          period?: string;
          price_profile_id?: string | null;
          starts_on?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'grocery_lists_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'grocery_lists_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'grocery_lists_price_profile_id_fkey';
            columns: ['price_profile_id'];
            isOneToOne: false;
            referencedRelation: 'price_profiles';
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
          downgrade_kept_at: string | null;
          family_size: number;
          hijri_offset_days: number;
          id: string;
          name: string;
          owner_user_id: string;
          preferences: NonNullable<Json>;
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
          downgrade_kept_at?: string | null;
          family_size?: number;
          hijri_offset_days?: number;
          id?: string;
          name: string;
          owner_user_id: string;
          preferences?: NonNullable<Json>;
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
          downgrade_kept_at?: string | null;
          family_size?: number;
          hijri_offset_days?: number;
          id?: string;
          name?: string;
          owner_user_id?: string;
          preferences?: NonNullable<Json>;
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
      hydration_logs: {
        Row: {
          beverage: string;
          created_at: string;
          family_member_id: string;
          household_id: string;
          id: string;
          logged_at: string;
          timing: string;
          updated_at: string;
          volume_ml: number;
        };
        Insert: {
          beverage?: string;
          created_at?: string;
          family_member_id: string;
          household_id: string;
          id?: string;
          logged_at?: string;
          timing?: string;
          updated_at?: string;
          volume_ml: number;
        };
        Update: {
          beverage?: string;
          created_at?: string;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          logged_at?: string;
          timing?: string;
          updated_at?: string;
          volume_ml?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'hydration_logs_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'hydration_logs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      hydration_targets: {
        Row: {
          basis: NonNullable<Json>;
          created_at: string;
          daily_ml: number;
          deleted_at: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          schedule: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          basis?: NonNullable<Json>;
          created_at?: string;
          daily_ml: number;
          deleted_at?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          schedule?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          basis?: NonNullable<Json>;
          created_at?: string;
          daily_ml?: number;
          deleted_at?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          schedule?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hydration_targets_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'hydration_targets_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
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
      ingredient_substitutions: {
        Row: {
          created_at: string;
          culinary_fit: number;
          from_ingredient_id: string;
          id: string;
          notes_i18n: NonNullable<Json>;
          nutrient_similarity: number;
          ratio: number;
          reason: string;
          region_codes: string[] | null;
          to_ingredient_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          culinary_fit: number;
          from_ingredient_id: string;
          id?: string;
          notes_i18n?: NonNullable<Json>;
          nutrient_similarity: number;
          ratio?: number;
          reason: string;
          region_codes?: string[] | null;
          to_ingredient_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          culinary_fit?: number;
          from_ingredient_id?: string;
          id?: string;
          notes_i18n?: NonNullable<Json>;
          nutrient_similarity?: number;
          ratio?: number;
          reason?: string;
          region_codes?: string[] | null;
          to_ingredient_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingredient_substitutions_from_ingredient_id_fkey';
            columns: ['from_ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingredient_substitutions_to_ingredient_id_fkey';
            columns: ['to_ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
        ];
      };
      ingredients: {
        Row: {
          aisle: string | null;
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
          purchase_units: NonNullable<Json>;
          sat_fat_g: number | null;
          shelf_life_days: number | null;
          sodium_mg: number | null;
          sugar_g: number | null;
          textures: Database['public']['Enums']['texture'][];
          updated_at: string;
          vitamin_a_mcg: number | null;
          vitamin_c_mg: number | null;
          vitamin_d_mcg: number | null;
          yield_factors: NonNullable<Json>;
          zinc_mg: number | null;
        };
        Insert: {
          aisle?: string | null;
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
          purchase_units?: NonNullable<Json>;
          sat_fat_g?: number | null;
          shelf_life_days?: number | null;
          sodium_mg?: number | null;
          sugar_g?: number | null;
          textures?: Database['public']['Enums']['texture'][];
          updated_at?: string;
          vitamin_a_mcg?: number | null;
          vitamin_c_mg?: number | null;
          vitamin_d_mcg?: number | null;
          yield_factors?: NonNullable<Json>;
          zinc_mg?: number | null;
        };
        Update: {
          aisle?: string | null;
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
          purchase_units?: NonNullable<Json>;
          sat_fat_g?: number | null;
          shelf_life_days?: number | null;
          sodium_mg?: number | null;
          sugar_g?: number | null;
          textures?: Database['public']['Enums']['texture'][];
          updated_at?: string;
          vitamin_a_mcg?: number | null;
          vitamin_c_mg?: number | null;
          vitamin_d_mcg?: number | null;
          yield_factors?: NonNullable<Json>;
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
      meal_alternatives: {
        Row: {
          alternative_meal_id: string;
          created_at: string;
          id: string;
          meal_id: string;
          notes: string | null;
          reason: string;
          review_status: Database['public']['Enums']['verification_status'];
          updated_at: string;
        };
        Insert: {
          alternative_meal_id: string;
          created_at?: string;
          id?: string;
          meal_id: string;
          notes?: string | null;
          reason: string;
          review_status?: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Update: {
          alternative_meal_id?: string;
          created_at?: string;
          id?: string;
          meal_id?: string;
          notes?: string | null;
          reason?: string;
          review_status?: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meal_alternatives_alternative_meal_id_fkey';
            columns: ['alternative_meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meal_alternatives_meal_id_fkey';
            columns: ['meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
            referencedColumns: ['id'];
          },
        ];
      };
      meal_logs: {
        Row: {
          created_at: string;
          daily_meal_serving_id: string | null;
          deleted_at: string | null;
          description: string;
          eaten_at: string;
          estimated_nutrition: NonNullable<Json>;
          family_member_id: string;
          fullness_after: number | null;
          fullness_before: number | null;
          household_id: string;
          id: string;
          logged_by_user_id: string | null;
          meal_type: Database['public']['Enums']['meal_type'];
          photo_path: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          daily_meal_serving_id?: string | null;
          deleted_at?: string | null;
          description?: string;
          eaten_at?: string;
          estimated_nutrition?: NonNullable<Json>;
          family_member_id: string;
          fullness_after?: number | null;
          fullness_before?: number | null;
          household_id: string;
          id?: string;
          logged_by_user_id?: string | null;
          meal_type: Database['public']['Enums']['meal_type'];
          photo_path?: string | null;
          source?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          daily_meal_serving_id?: string | null;
          deleted_at?: string | null;
          description?: string;
          eaten_at?: string;
          estimated_nutrition?: NonNullable<Json>;
          family_member_id?: string;
          fullness_after?: number | null;
          fullness_before?: number | null;
          household_id?: string;
          id?: string;
          logged_by_user_id?: string | null;
          meal_type?: Database['public']['Enums']['meal_type'];
          photo_path?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meal_logs_daily_meal_serving_id_fkey';
            columns: ['daily_meal_serving_id'];
            isOneToOne: false;
            referencedRelation: 'daily_meal_servings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meal_logs_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'meal_logs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meal_logs_logged_by_user_id_fkey';
            columns: ['logged_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      meal_plans: {
        Row: {
          budget_profile_id: string | null;
          created_at: string;
          created_by_user_id: string | null;
          deleted_at: string | null;
          end_date: string;
          failure_reason: string | null;
          generated_by_assessment_id: string | null;
          generation_meta: NonNullable<Json>;
          generation_progress: NonNullable<Json>;
          household_id: string;
          id: string;
          kind: Database['public']['Enums']['plan_kind'];
          parent_plan_id: string | null;
          rationale: string | null;
          start_date: string;
          status: Database['public']['Enums']['plan_status'];
          title: string | null;
          updated_at: string;
          version: number;
          week_count: number;
          weekly_themes: NonNullable<Json>;
        };
        Insert: {
          budget_profile_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          deleted_at?: string | null;
          end_date: string;
          failure_reason?: string | null;
          generated_by_assessment_id?: string | null;
          generation_meta?: NonNullable<Json>;
          generation_progress?: NonNullable<Json>;
          household_id: string;
          id?: string;
          kind?: Database['public']['Enums']['plan_kind'];
          parent_plan_id?: string | null;
          rationale?: string | null;
          start_date: string;
          status?: Database['public']['Enums']['plan_status'];
          title?: string | null;
          updated_at?: string;
          version?: number;
          week_count?: number;
          weekly_themes?: NonNullable<Json>;
        };
        Update: {
          budget_profile_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          deleted_at?: string | null;
          end_date?: string;
          failure_reason?: string | null;
          generated_by_assessment_id?: string | null;
          generation_meta?: NonNullable<Json>;
          generation_progress?: NonNullable<Json>;
          household_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['plan_kind'];
          parent_plan_id?: string | null;
          rationale?: string | null;
          start_date?: string;
          status?: Database['public']['Enums']['plan_status'];
          title?: string | null;
          updated_at?: string;
          version?: number;
          week_count?: number;
          weekly_themes?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'meal_plans_budget_profile_id_household_id_fkey';
            columns: ['budget_profile_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'budget_profiles';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'meal_plans_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meal_plans_generated_by_assessment_id_household_id_fkey';
            columns: ['generated_by_assessment_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'ai_assessments';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'meal_plans_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'meal_plans_parent_plan_id_household_id_fkey';
            columns: ['parent_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
        ];
      };
      meals: {
        Row: {
          code: string | null;
          components: NonNullable<Json>;
          created_at: string;
          deleted_at: string | null;
          household_id: string | null;
          id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          plate_split: NonNullable<Json>;
          review_status: Database['public']['Enums']['verification_status'];
          source: string;
          title: string;
          title_i18n: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          components: NonNullable<Json>;
          created_at?: string;
          deleted_at?: string | null;
          household_id?: string | null;
          id?: string;
          meal_type: Database['public']['Enums']['meal_type'];
          plate_split?: NonNullable<Json>;
          review_status?: Database['public']['Enums']['verification_status'];
          source?: string;
          title: string;
          title_i18n?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          components?: NonNullable<Json>;
          created_at?: string;
          deleted_at?: string | null;
          household_id?: string | null;
          id?: string;
          meal_type?: Database['public']['Enums']['meal_type'];
          plate_split?: NonNullable<Json>;
          review_status?: Database['public']['Enums']['verification_status'];
          source?: string;
          title?: string;
          title_i18n?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'meals_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      medical_conditions: {
        Row: {
          condition_code: string | null;
          created_at: string;
          deleted_at: string | null;
          diagnosed_on: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          label: string;
          notes: string | null;
          on_insulin_or_sulfonylurea: boolean;
          updated_at: string;
        };
        Insert: {
          condition_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          diagnosed_on?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          label: string;
          notes?: string | null;
          on_insulin_or_sulfonylurea?: boolean;
          updated_at?: string;
        };
        Update: {
          condition_code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          diagnosed_on?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          label?: string;
          notes?: string | null;
          on_insulin_or_sulfonylurea?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'medical_conditions_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'medical_conditions_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      medications: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          dose: string | null;
          family_member_id: string;
          food_interaction_flags: string[];
          frequency: string | null;
          household_id: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          dose?: string | null;
          family_member_id: string;
          food_interaction_flags?: string[];
          frequency?: string | null;
          household_id: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          dose?: string | null;
          family_member_id?: string;
          food_interaction_flags?: string[];
          frequency?: string | null;
          household_id?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'medications_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'medications_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          kind: string;
          quiet_hours: NonNullable<Json>;
          settings: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          kind: string;
          quiet_hours?: NonNullable<Json>;
          settings?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          kind?: string;
          quiet_hours?: NonNullable<Json>;
          settings?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          attempts: number;
          body: string;
          channel: Database['public']['Enums']['notification_channel'];
          created_at: string;
          data: NonNullable<Json>;
          dedupe_key: string | null;
          household_id: string | null;
          id: string;
          kind: string;
          onesignal_id: string | null;
          read_at: string | null;
          scheduled_for: string;
          sent_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          body: string;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          data?: NonNullable<Json>;
          dedupe_key?: string | null;
          household_id?: string | null;
          id?: string;
          kind: string;
          onesignal_id?: string | null;
          read_at?: string | null;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          body?: string;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          data?: NonNullable<Json>;
          dedupe_key?: string | null;
          household_id?: string | null;
          id?: string;
          kind?: string;
          onesignal_id?: string | null;
          read_at?: string | null;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      nutrition_goals: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          family_member_id: string;
          goal_type: Database['public']['Enums']['goal_type'];
          household_id: string;
          id: string;
          is_primary: boolean;
          target_date: string | null;
          target_unit: string | null;
          target_value: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id: string;
          goal_type: Database['public']['Enums']['goal_type'];
          household_id: string;
          id?: string;
          is_primary?: boolean;
          target_date?: string | null;
          target_unit?: string | null;
          target_value?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          family_member_id?: string;
          goal_type?: Database['public']['Enums']['goal_type'];
          household_id?: string;
          id?: string;
          is_primary?: boolean;
          target_date?: string | null;
          target_unit?: string | null;
          target_value?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'nutrition_goals_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'nutrition_goals_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      nutrition_journal: {
        Row: {
          created_at: string;
          digestion: number | null;
          energy: number | null;
          family_member_id: string;
          household_id: string;
          id: string;
          journal_date: string;
          mood: number | null;
          notes: string | null;
          thuluth_adherence: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          digestion?: number | null;
          energy?: number | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          journal_date: string;
          mood?: number | null;
          notes?: string | null;
          thuluth_adherence?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          digestion?: number | null;
          energy?: number | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          journal_date?: string;
          mood?: number | null;
          notes?: string | null;
          thuluth_adherence?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'nutrition_journal_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'nutrition_journal_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      pantry_items: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          expires_on: string | null;
          grams: number;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          label: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          expires_on?: string | null;
          grams: number;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          label: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          expires_on?: string | null;
          grams?: number;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          label?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pantry_items_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_items_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pantry_items_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      plan_recommendations: {
        Row: {
          chat_message_id: string | null;
          created_at: string;
          family_member_id: string | null;
          household_id: string;
          id: string;
          meal_plan_id: string | null;
          recommendation_id: string;
          updated_at: string;
        };
        Insert: {
          chat_message_id?: string | null;
          created_at?: string;
          family_member_id?: string | null;
          household_id: string;
          id?: string;
          meal_plan_id?: string | null;
          recommendation_id: string;
          updated_at?: string;
        };
        Update: {
          chat_message_id?: string | null;
          created_at?: string;
          family_member_id?: string | null;
          household_id?: string;
          id?: string;
          meal_plan_id?: string | null;
          recommendation_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_recommendations_chat_message_id_fkey';
            columns: ['chat_message_id'];
            isOneToOne: false;
            referencedRelation: 'chat_messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plan_recommendations_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'plan_recommendations_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plan_recommendations_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'plan_recommendations_recommendation_id_fkey';
            columns: ['recommendation_id'];
            isOneToOne: false;
            referencedRelation: 'recommendations';
            referencedColumns: ['id'];
          },
        ];
      };
      portions: {
        Row: {
          created_at: string;
          grams: number;
          household_id: string | null;
          household_measure: string;
          household_measure_i18n: NonNullable<Json>;
          id: string;
          kcal: number | null;
          life_stage: Database['public']['Enums']['life_stage'];
          meal_id: string | null;
          recipe_id: string | null;
          review_status: Database['public']['Enums']['verification_status'];
          tier: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          grams: number;
          household_id?: string | null;
          household_measure: string;
          household_measure_i18n?: NonNullable<Json>;
          id?: string;
          kcal?: number | null;
          life_stage: Database['public']['Enums']['life_stage'];
          meal_id?: string | null;
          recipe_id?: string | null;
          review_status?: Database['public']['Enums']['verification_status'];
          tier?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          grams?: number;
          household_id?: string | null;
          household_measure?: string;
          household_measure_i18n?: NonNullable<Json>;
          id?: string;
          kcal?: number | null;
          life_stage?: Database['public']['Enums']['life_stage'];
          meal_id?: string | null;
          recipe_id?: string | null;
          review_status?: Database['public']['Enums']['verification_status'];
          tier?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'portions_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portions_meal_id_fkey';
            columns: ['meal_id'];
            isOneToOne: false;
            referencedRelation: 'meals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portions_recipe_id_fkey';
            columns: ['recipe_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id'];
          },
        ];
      };
      prayer_times_cache: {
        Row: {
          city: string;
          country_code: string;
          created_at: string;
          fetched_at: string;
          hijri: NonNullable<Json>;
          id: string;
          method: number;
          month: number;
          school: number;
          source: string;
          timings: NonNullable<Json>;
          updated_at: string;
          year: number;
        };
        Insert: {
          city: string;
          country_code: string;
          created_at?: string;
          fetched_at?: string;
          hijri?: NonNullable<Json>;
          id?: string;
          method: number;
          month: number;
          school?: number;
          source?: string;
          timings: NonNullable<Json>;
          updated_at?: string;
          year: number;
        };
        Update: {
          city?: string;
          country_code?: string;
          created_at?: string;
          fetched_at?: string;
          hijri?: NonNullable<Json>;
          id?: string;
          method?: number;
          month?: number;
          school?: number;
          source?: string;
          timings?: NonNullable<Json>;
          updated_at?: string;
          year?: number;
        };
        Relationships: [];
      };
      pregnancy_profiles: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          due_date: string | null;
          family_member_id: string;
          gestational_diabetes: boolean;
          household_id: string;
          id: string;
          trimester: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          due_date?: string | null;
          family_member_id: string;
          gestational_diabetes?: boolean;
          household_id: string;
          id?: string;
          trimester?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          due_date?: string | null;
          family_member_id?: string;
          gestational_diabetes?: boolean;
          household_id?: string;
          id?: string;
          trimester?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pregnancy_profiles_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'pregnancy_profiles_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      price_observations: {
        Row: {
          amount_minor: number;
          created_at: string;
          id: string;
          ingredient_id: string;
          moderation_status: string;
          observed_on: string;
          price_profile_id: string;
          reporter_user_id: string | null;
          source: Database['public']['Enums']['price_source'];
          unit: string;
          unit_grams: number | null;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          id?: string;
          ingredient_id: string;
          moderation_status?: string;
          observed_on?: string;
          price_profile_id: string;
          reporter_user_id?: string | null;
          source: Database['public']['Enums']['price_source'];
          unit: string;
          unit_grams?: number | null;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          id?: string;
          ingredient_id?: string;
          moderation_status?: string;
          observed_on?: string;
          price_profile_id?: string;
          reporter_user_id?: string | null;
          source?: Database['public']['Enums']['price_source'];
          unit?: string;
          unit_grams?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'price_observations_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_observations_price_profile_id_fkey';
            columns: ['price_profile_id'];
            isOneToOne: false;
            referencedRelation: 'price_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_observations_reporter_user_id_fkey';
            columns: ['reporter_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      price_profiles: {
        Row: {
          city: string | null;
          created_at: string;
          currency: string;
          effective_from: string;
          id: string;
          label: string | null;
          region_id: string;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          currency: string;
          effective_from: string;
          id?: string;
          label?: string | null;
          region_id: string;
          updated_at?: string;
        };
        Update: {
          city?: string | null;
          created_at?: string;
          currency?: string;
          effective_from?: string;
          id?: string;
          label?: string | null;
          region_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'price_profiles_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      promo_campaigns: {
        Row: {
          allowed_countries: string[] | null;
          created_at: string;
          created_by: string | null;
          ends_at: string;
          grant_days: number;
          id: string;
          max_redemptions: number;
          name: string;
          org_kind: string;
          redeemed_count: number;
          starts_at: string;
          updated_at: string;
        };
        Insert: {
          allowed_countries?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          ends_at: string;
          grant_days: number;
          id?: string;
          max_redemptions: number;
          name: string;
          org_kind: string;
          redeemed_count?: number;
          starts_at: string;
          updated_at?: string;
        };
        Update: {
          allowed_countries?: string[] | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string;
          grant_days?: number;
          id?: string;
          max_redemptions?: number;
          name?: string;
          org_kind?: string;
          redeemed_count?: number;
          starts_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'promo_campaigns_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      promo_codes: {
        Row: {
          campaign_id: string;
          code_hash: string;
          created_at: string;
          id: string;
          redeemed_at: string | null;
          single_use: boolean;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          code_hash: string;
          created_at?: string;
          id?: string;
          redeemed_at?: string | null;
          single_use?: boolean;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          code_hash?: string;
          created_at?: string;
          id?: string;
          redeemed_at?: string | null;
          single_use?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'promo_codes_campaign_id_fkey';
            columns: ['campaign_id'];
            isOneToOne: false;
            referencedRelation: 'promo_campaigns';
            referencedColumns: ['id'];
          },
        ];
      };
      promo_redemptions: {
        Row: {
          created_at: string;
          granted_until: string;
          id: string;
          promo_code_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_until: string;
          id?: string;
          promo_code_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_until?: string;
          id?: string;
          promo_code_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'promo_redemptions_promo_code_id_fkey';
            columns: ['promo_code_id'];
            isOneToOne: false;
            referencedRelation: 'promo_codes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'promo_redemptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
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
      ramadan_plans: {
        Row: {
          calc_params: NonNullable<Json>;
          child_participation: NonNullable<Json>;
          city_prayer_times_source: string;
          created_at: string;
          deleted_at: string | null;
          end_date: string;
          hijri_year: number;
          household_id: string;
          id: string;
          meal_plan_id: string | null;
          prayer_times: NonNullable<Json>;
          pregnancy_adjustments: NonNullable<Json>;
          start_date: string;
          suhoor_time_strategy: string;
          updated_at: string;
        };
        Insert: {
          calc_params?: NonNullable<Json>;
          child_participation?: NonNullable<Json>;
          city_prayer_times_source?: string;
          created_at?: string;
          deleted_at?: string | null;
          end_date: string;
          hijri_year: number;
          household_id: string;
          id?: string;
          meal_plan_id?: string | null;
          prayer_times?: NonNullable<Json>;
          pregnancy_adjustments?: NonNullable<Json>;
          start_date: string;
          suhoor_time_strategy?: string;
          updated_at?: string;
        };
        Update: {
          calc_params?: NonNullable<Json>;
          child_participation?: NonNullable<Json>;
          city_prayer_times_source?: string;
          created_at?: string;
          deleted_at?: string | null;
          end_date?: string;
          hijri_year?: number;
          household_id?: string;
          id?: string;
          meal_plan_id?: string | null;
          prayer_times?: NonNullable<Json>;
          pregnancy_adjustments?: NonNullable<Json>;
          start_date?: string;
          suhoor_time_strategy?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ramadan_plans_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ramadan_plans_meal_plan_id_household_id_fkey';
            columns: ['meal_plan_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'meal_plans';
            referencedColumns: ['id', 'household_id'];
          },
        ];
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
      recipe_ingredients: {
        Row: {
          created_at: string;
          grams: number;
          id: string;
          ingredient_id: string;
          optional: boolean;
          prep_note: string | null;
          quantity: number;
          recipe_id: string;
          sort_order: number;
          unit: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          grams: number;
          id?: string;
          ingredient_id: string;
          optional?: boolean;
          prep_note?: string | null;
          quantity: number;
          recipe_id: string;
          sort_order?: number;
          unit: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          grams?: number;
          id?: string;
          ingredient_id?: string;
          optional?: boolean;
          prep_note?: string | null;
          quantity?: number;
          recipe_id?: string;
          sort_order?: number;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipe_ingredients_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recipe_ingredients_recipe_id_fkey';
            columns: ['recipe_id'];
            isOneToOne: false;
            referencedRelation: 'recipes';
            referencedColumns: ['id'];
          },
        ];
      };
      recipes: {
        Row: {
          autism_friendly: boolean;
          colors: string[];
          cook_min: number;
          cost_tier: number;
          created_at: string;
          created_by_user_id: string | null;
          cuisine: string;
          deleted_at: string | null;
          household_id: string | null;
          id: string;
          image_path: string | null;
          kid_friendly: boolean;
          meal_types: Database['public']['Enums']['meal_type'][];
          per_serving_nutrition: NonNullable<Json>;
          prep_min: number;
          ramadan_suitable: boolean;
          region_tags: string[];
          review_status: Database['public']['Enums']['verification_status'];
          servings: number;
          source: string;
          steps: NonNullable<Json>;
          texture_profile: Database['public']['Enums']['texture'][];
          title: string;
          title_i18n: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          autism_friendly?: boolean;
          colors?: string[];
          cook_min?: number;
          cost_tier?: number;
          created_at?: string;
          created_by_user_id?: string | null;
          cuisine?: string;
          deleted_at?: string | null;
          household_id?: string | null;
          id?: string;
          image_path?: string | null;
          kid_friendly?: boolean;
          meal_types: Database['public']['Enums']['meal_type'][];
          per_serving_nutrition?: NonNullable<Json>;
          prep_min?: number;
          ramadan_suitable?: boolean;
          region_tags?: string[];
          review_status?: Database['public']['Enums']['verification_status'];
          servings: number;
          source?: string;
          steps?: NonNullable<Json>;
          texture_profile?: Database['public']['Enums']['texture'][];
          title: string;
          title_i18n?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          autism_friendly?: boolean;
          colors?: string[];
          cook_min?: number;
          cost_tier?: number;
          created_at?: string;
          created_by_user_id?: string | null;
          cuisine?: string;
          deleted_at?: string | null;
          household_id?: string | null;
          id?: string;
          image_path?: string | null;
          kid_friendly?: boolean;
          meal_types?: Database['public']['Enums']['meal_type'][];
          per_serving_nutrition?: NonNullable<Json>;
          prep_min?: number;
          ramadan_suitable?: boolean;
          region_tags?: string[];
          review_status?: Database['public']['Enums']['verification_status'];
          servings?: number;
          source?: string;
          steps?: NonNullable<Json>;
          texture_profile?: Database['public']['Enums']['texture'][];
          title?: string;
          title_i18n?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recipes_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recipes_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
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
          embedding: string | null;
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
          embedding?: string | null;
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
          embedding?: string | null;
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
      revenuecat_events: {
        Row: {
          app_user_id: string;
          created_at: string;
          environment: string;
          error: string | null;
          event_id: string;
          event_timestamp: string;
          payload: NonNullable<Json>;
          processed_at: string | null;
          received_at: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          app_user_id: string;
          created_at?: string;
          environment: string;
          error?: string | null;
          event_id: string;
          event_timestamp: string;
          payload: NonNullable<Json>;
          processed_at?: string | null;
          received_at?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          app_user_id?: string;
          created_at?: string;
          environment?: string;
          error?: string | null;
          event_id?: string;
          event_timestamp?: string;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          received_at?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      safety_events: {
        Row: {
          category: string;
          chat_message_id: string | null;
          created_at: string;
          evidence: string | null;
          family_member_id: string | null;
          household_id: string;
          id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          resolved_note: string | null;
          source: string;
          updated_at: string;
          urgency: string;
          user_id: string | null;
        };
        Insert: {
          category: string;
          chat_message_id?: string | null;
          created_at?: string;
          evidence?: string | null;
          family_member_id?: string | null;
          household_id: string;
          id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolved_note?: string | null;
          source: string;
          updated_at?: string;
          urgency: string;
          user_id?: string | null;
        };
        Update: {
          category?: string;
          chat_message_id?: string | null;
          created_at?: string;
          evidence?: string | null;
          family_member_id?: string | null;
          household_id?: string;
          id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolved_note?: string | null;
          source?: string;
          updated_at?: string;
          urgency?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'safety_events_chat_message_id_fkey';
            columns: ['chat_message_id'];
            isOneToOne: false;
            referencedRelation: 'chat_messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'safety_events_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'safety_events_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'safety_events_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'safety_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
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
      seasonal_produce: {
        Row: {
          availability: string;
          created_at: string;
          id: string;
          ingredient_id: string;
          month: number;
          price_index: number;
          region_id: string;
          updated_at: string;
        };
        Insert: {
          availability: string;
          created_at?: string;
          id?: string;
          ingredient_id: string;
          month: number;
          price_index?: number;
          region_id: string;
          updated_at?: string;
        };
        Update: {
          availability?: string;
          created_at?: string;
          id?: string;
          ingredient_id?: string;
          month?: number;
          price_index?: number;
          region_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'seasonal_produce_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'seasonal_produce_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      sensory_profiles: {
        Row: {
          brand_rigidity: boolean;
          color_sensitivities: string[];
          created_at: string;
          deleted_at: string | null;
          family_member_id: string;
          household_id: string;
          id: string;
          presentation_prefs: NonNullable<Json>;
          temperature_prefs: string[];
          texture_avoids: Database['public']['Enums']['texture'][];
          texture_likes: Database['public']['Enums']['texture'][];
          updated_at: string;
        };
        Insert: {
          brand_rigidity?: boolean;
          color_sensitivities?: string[];
          created_at?: string;
          deleted_at?: string | null;
          family_member_id: string;
          household_id: string;
          id?: string;
          presentation_prefs?: NonNullable<Json>;
          temperature_prefs?: string[];
          texture_avoids?: Database['public']['Enums']['texture'][];
          texture_likes?: Database['public']['Enums']['texture'][];
          updated_at?: string;
        };
        Update: {
          brand_rigidity?: boolean;
          color_sensitivities?: string[];
          created_at?: string;
          deleted_at?: string | null;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          presentation_prefs?: NonNullable<Json>;
          temperature_prefs?: string[];
          texture_avoids?: Database['public']['Enums']['texture'][];
          texture_likes?: Database['public']['Enums']['texture'][];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sensory_profiles_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'sensory_profiles_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      shopping_items: {
        Row: {
          actual_minor: number | null;
          aisle: string | null;
          created_at: string;
          estimated_minor: number | null;
          grocery_list_id: string;
          household_id: string;
          id: string;
          ingredient_id: string | null;
          is_checked: boolean;
          is_fresh: boolean;
          label: string;
          quantity: number;
          sort_order: number;
          substitution_for_item_id: string | null;
          unit: string;
          updated_at: string;
        };
        Insert: {
          actual_minor?: number | null;
          aisle?: string | null;
          created_at?: string;
          estimated_minor?: number | null;
          grocery_list_id: string;
          household_id: string;
          id?: string;
          ingredient_id?: string | null;
          is_checked?: boolean;
          is_fresh?: boolean;
          label: string;
          quantity?: number;
          sort_order?: number;
          substitution_for_item_id?: string | null;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          actual_minor?: number | null;
          aisle?: string | null;
          created_at?: string;
          estimated_minor?: number | null;
          grocery_list_id?: string;
          household_id?: string;
          id?: string;
          ingredient_id?: string | null;
          is_checked?: boolean;
          is_fresh?: boolean;
          label?: string;
          quantity?: number;
          sort_order?: number;
          substitution_for_item_id?: string | null;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shopping_items_grocery_list_id_household_id_fkey';
            columns: ['grocery_list_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'grocery_lists';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'shopping_items_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_items_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shopping_items_substitution_for_item_id_fkey';
            columns: ['substitution_for_item_id'];
            isOneToOne: false;
            referencedRelation: 'shopping_items';
            referencedColumns: ['id'];
          },
        ];
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
          country_code: string | null;
          created_at: string;
          current_period_end: string | null;
          entitlement: string;
          environment: string;
          grace_period_expires_at: string | null;
          id: string;
          last_event_at: string | null;
          last_event_id: string | null;
          original_transaction_id: string | null;
          period_type: string | null;
          product_id: string;
          raw_event: NonNullable<Json>;
          rc_app_user_id: string;
          refunded_at: string | null;
          status: Database['public']['Enums']['subscription_status'];
          store: string;
          tier: Database['public']['Enums']['subscription_tier'];
          updated_at: string;
          user_id: string;
          will_renew: boolean;
        };
        Insert: {
          country_code?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          entitlement?: string;
          environment?: string;
          grace_period_expires_at?: string | null;
          id?: string;
          last_event_at?: string | null;
          last_event_id?: string | null;
          original_transaction_id?: string | null;
          period_type?: string | null;
          product_id: string;
          raw_event?: NonNullable<Json>;
          rc_app_user_id: string;
          refunded_at?: string | null;
          status: Database['public']['Enums']['subscription_status'];
          store: string;
          tier?: Database['public']['Enums']['subscription_tier'];
          updated_at?: string;
          user_id: string;
          will_renew?: boolean;
        };
        Update: {
          country_code?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          entitlement?: string;
          environment?: string;
          grace_period_expires_at?: string | null;
          id?: string;
          last_event_at?: string | null;
          last_event_id?: string | null;
          original_transaction_id?: string | null;
          period_type?: string | null;
          product_id?: string;
          raw_event?: NonNullable<Json>;
          rc_app_user_id?: string;
          refunded_at?: string | null;
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
      supplements: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          dose: string | null;
          family_member_id: string;
          frequency: string | null;
          household_id: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          dose?: string | null;
          family_member_id: string;
          frequency?: string | null;
          household_id: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          dose?: string | null;
          family_member_id?: string;
          frequency?: string | null;
          household_id?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'supplements_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'supplements_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          age_attested_at: string | null;
          ai_memory_enabled: boolean;
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
          ai_memory_enabled?: boolean;
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
          ai_memory_enabled?: boolean;
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
      weight_tracking: {
        Row: {
          bmi: number | null;
          created_at: string;
          family_member_id: string;
          household_id: string;
          id: string;
          measured_on: string;
          updated_at: string;
          waist_cm: number | null;
          weight_kg: number;
        };
        Insert: {
          bmi?: number | null;
          created_at?: string;
          family_member_id: string;
          household_id: string;
          id?: string;
          measured_on: string;
          updated_at?: string;
          waist_cm?: number | null;
          weight_kg: number;
        };
        Update: {
          bmi?: number | null;
          created_at?: string;
          family_member_id?: string;
          household_id?: string;
          id?: string;
          measured_on?: string;
          updated_at?: string;
          waist_cm?: number | null;
          weight_kg?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'weight_tracking_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'weight_tracking_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
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
      fasting_logs_visible: {
        Row: {
          completed: boolean | null;
          created_at: string | null;
          ended_at: string | null;
          exemption_reason: string | null;
          family_member_id: string | null;
          fast_date: string | null;
          hijri_date: string | null;
          household_id: string | null;
          id: string | null;
          is_practice_fast: boolean | null;
          kind: Database['public']['Enums']['fast_kind'] | null;
          qada_for_hijri_year: number | null;
          started_at: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fasting_logs_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'fasting_logs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
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
      mv_current_prices: {
        Row: {
          ingredient_id: string | null;
          price_per_kg_minor: number | null;
          price_profile_id: string | null;
          refreshed_at: string | null;
          total_weight: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'price_observations_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_observations_price_profile_id_fkey';
            columns: ['price_profile_id'];
            isOneToOne: false;
            referencedRelation: 'price_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      mv_ingredient_prices: {
        Row: {
          has_live_data: boolean | null;
          ingredient_id: string | null;
          last_observed_on: string | null;
          median_minor: number | null;
          n_observations: number | null;
          price_profile_id: string | null;
          unit: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'price_observations_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'price_observations_price_profile_id_fkey';
            columns: ['price_profile_id'];
            isOneToOne: false;
            referencedRelation: 'price_profiles';
            referencedColumns: ['id'];
          },
        ];
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
      v_qada_balance: {
        Row: {
          family_member_id: string | null;
          hijri_year: number | null;
          household_id: string | null;
          made_up: number | null;
          missed: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fasting_logs_family_member_id_household_id_fkey';
            columns: ['family_member_id', 'household_id'];
            isOneToOne: false;
            referencedRelation: 'family_members';
            referencedColumns: ['id', 'household_id'];
          },
          {
            foreignKeyName: 'fasting_logs_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      accept_household_invitation: {
        Args: { p_invitation_id: string; p_user_id: string };
        Returns: undefined;
      };
      acquire_job_lease: {
        Args: { p_holder: string; p_name: string; p_ttl_seconds?: number };
        Returns: boolean;
      };
      activate_meal_plan: {
        Args: { p_meal_plan_id: string };
        Returns: {
          budget_profile_id: string | null;
          created_at: string;
          created_by_user_id: string | null;
          deleted_at: string | null;
          end_date: string;
          failure_reason: string | null;
          generated_by_assessment_id: string | null;
          generation_meta: NonNullable<Json>;
          generation_progress: NonNullable<Json>;
          household_id: string;
          id: string;
          kind: Database['public']['Enums']['plan_kind'];
          parent_plan_id: string | null;
          rationale: string | null;
          start_date: string;
          status: Database['public']['Enums']['plan_status'];
          title: string | null;
          updated_at: string;
          version: number;
          week_count: number;
          weekly_themes: NonNullable<Json>;
        };
        SetofOptions: {
          from: '*';
          to: 'meal_plans';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      age_in_months: { Args: { p_dob: string; p_on?: string }; Returns: number };
      ai_quota_check: {
        Args: { p_route_key: string; p_user_id: string };
        Returns: {
          allowed: boolean;
          degrade_to: string;
          remaining: number;
        }[];
      };
      can_author_plans: { Args: { p_household_id: string }; Returns: boolean };
      can_edit_household: { Args: { p_household_id: string }; Returns: boolean };
      catalog_review_statuses: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Enums']['verification_status'][];
      };
      clear_ai_memories: { Args: { p_household_id: string }; Returns: number };
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
      get_my_entitlements: { Args: { p_household?: string }; Returns: Json };
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
      household_is_read_only: {
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
      keep_household_on_downgrade: {
        Args: { p_household_id: string };
        Returns: undefined;
      };
      life_stage_for_dob: {
        Args: { p_dob: string; p_on?: string };
        Returns: Database['public']['Enums']['life_stage'];
      };
      match_ai_memories: {
        Args: {
          p_family_member_id?: string;
          p_household_id: string;
          p_limit?: number;
          p_query_embedding: string;
        };
        Returns: {
          confidence: number;
          created_at: string;
          fact: string;
          family_member_id: string;
          id: string;
          kind: string;
          score: number;
          similarity: number;
        }[];
      };
      match_knowledge: {
        Args: {
          p_item_kinds?: string[];
          p_match_count?: number;
          p_query_embedding: string;
          p_traditions: Database['public']['Enums']['source_tradition'][];
        };
        Returns: {
          code: string;
          item_id: string;
          item_kind: string;
          label: string;
          similarity: number;
          traditions: Database['public']['Enums']['source_tradition'][];
        }[];
      };
      my_household_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      notification_default_enabled: {
        Args: { p_kind: string };
        Returns: boolean;
      };
      notification_kinds: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      path_household_id: { Args: { p_name: string }; Returns: string };
      path_segment_uuid: {
        Args: { p_index: number; p_name: string };
        Returns: string;
      };
      plan_generation_ack: {
        Args: { p_archive?: boolean; p_msg_id: number };
        Returns: boolean;
      };
      plan_generation_enqueue: {
        Args: {
          p_attempt?: number;
          p_delay_seconds?: number;
          p_meal_plan_id: string;
        };
        Returns: number;
      };
      plan_generation_read: {
        Args: { p_qty?: number; p_vt_seconds?: number };
        Returns: {
          enqueued_at: string;
          message: Json;
          msg_id: number;
          read_ct: number;
          vt: string;
        }[];
      };
      premium_for: { Args: { p_household?: string }; Returns: boolean };
      recommendation_completeness: {
        Args: Record<PropertyKey, never>;
        Returns: {
          blocking: boolean;
          code: string;
          issue: string;
          recommendation_id: string;
          review_status: Database['public']['Enums']['verification_status'];
        }[];
      };
      recompute_recipe_nutrition: {
        Args: { p_recipe_id: string };
        Returns: undefined;
      };
      refresh_ingredient_prices: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      release_job_lease: {
        Args: { p_holder: string; p_name: string };
        Returns: undefined;
      };
      search_islamic_sources: {
        Args: {
          p_kinds?: Database['public']['Enums']['source_kind'][];
          p_limit?: number;
          p_query_embedding: string;
          p_query_text: string;
          p_traditions: Database['public']['Enums']['source_tradition'][];
        };
        Returns: {
          citation_text: string;
          code: string;
          islamic_source_id: string;
          kind: Database['public']['Enums']['source_kind'];
          score: number;
          tradition: Database['public']['Enums']['source_tradition'];
        }[];
      };
      set_hydration_target: {
        Args: {
          p_basis?: Json;
          p_daily_ml: number;
          p_family_member_id: string;
          p_household_id: string;
          p_schedule?: Json;
        };
        Returns: string;
      };
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean };
      soft_delete: {
        Args: { p_id: string; p_table: string };
        Returns: undefined;
      };
      swap_daily_meal: {
        Args: { p_alternative_meal_id: string; p_daily_meal_id: string };
        Returns: {
          batch_multiplier: number;
          created_at: string;
          household_id: string;
          id: string;
          is_lunchbox: boolean;
          meal_id: string;
          meal_plan_id: string;
          meal_type: Database['public']['Enums']['meal_type'];
          notes: string | null;
          plan_date: string;
          scheduled_time: string | null;
          slot: number;
          source_daily_meal_id: string | null;
          swapped_from_meal_id: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'daily_meals';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      transfer_household_ownership: {
        Args: { p_household_id: string; p_new_owner: string };
        Returns: undefined;
      };
      write_plan_week: {
        Args: { p_meal_plan_id: string; p_week: Json };
        Returns: number;
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
