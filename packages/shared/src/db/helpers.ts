// Friendly aliases over the generated Supabase types (10-supabase-structure.md section 13.3).
// database.types.ts is GENERATED (`supabase gen types typescript --local --schema public`);
// never edit it by hand. Regenerate after every migration.
export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './database.types.ts';
export { Constants } from './database.types.ts';

import type { Enums, Tables } from './database.types.ts';

export type UserRow = Tables<'users'>;
export type Household = Tables<'households'>;
export type HouseholdMember = Tables<'household_members'>;
export type Subscription = Tables<'subscriptions'>;
export type FeatureFlag = Tables<'feature_flags'>;
export type AiModelRoute = Tables<'ai_model_routes'>;
export type AiUsage = Tables<'ai_usage'>;
export type PromptTemplate = Tables<'prompt_templates'>;
export type AnalyticsEvent = Tables<'analytics_events'>;

export type HouseholdRole = Enums<'household_role'>;
export type LifeStage = Enums<'life_stage'>;
export type SubscriptionTier = Enums<'subscription_tier'>;
export type SubscriptionStatus = Enums<'subscription_status'>;
