/**
 * Const arrays mirroring the canonical Postgres enums in docs/00-foundations.md §5.
 * Values are additive only; keep in the same order as the SQL definitions.
 */
export const HOUSEHOLD_ROLES = ['owner', 'caregiver', 'viewer', 'coach'] as const;
export const SEXES_AT_BIRTH = ['female', 'male', 'unspecified'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export const LIFE_STAGES = ['infant', 'toddler', 'child', 'teen', 'adult', 'older_adult'] as const;
export const GOAL_TYPES = [
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
] as const;
export const SPECIAL_MODULES = [
  'pregnancy',
  'breastfeeding',
  'autism',
  'adhd',
  'picky_eater',
] as const;
export const MEAL_TYPES = ['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar'] as const;
export const MEAL_STATUSES = ['planned', 'eaten', 'partly_eaten', 'skipped', 'swapped'] as const;
export const PLAN_STATUSES = [
  'draft',
  'generating',
  'active',
  'completed',
  'archived',
  'failed',
] as const;
export const PLAN_KINDS = ['standard', 'ramadan', 'growth', 'weight_management', 'custom'] as const;
export const SEVERITIES = ['mild', 'moderate', 'severe', 'anaphylactic'] as const;
export const EVIDENCE_GRADES_HADITH = [
  'sahih',
  'hasan',
  'daif',
  'mawdu',
  'sahih_shia',
  'muwaththaq',
  'hasan_shia',
  'daif_shia',
  'ungraded',
] as const;
export const EVIDENCE_GRADES_SCIENCE = [
  'high',
  'moderate',
  'low',
  'very_low',
  'expert_opinion',
] as const;
export const SOURCE_TRADITIONS = ['shared', 'sunni', 'shia'] as const;
export const SOURCE_KINDS = ['quran', 'hadith', 'imam_narration', 'scholarly'] as const;
export const VERIFICATION_STATUSES = ['unverified', 'in_review', 'verified', 'rejected'] as const;
export const SUBSCRIPTION_TIERS = ['free', 'premium'] as const;
export const SUBSCRIPTION_STATUSES = [
  'active',
  'in_grace',
  'in_billing_retry',
  'cancelled',
  'expired',
  'paused',
] as const;
export const CHAT_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export const NOTIFICATION_CHANNELS = ['push', 'in_app', 'email'] as const;
export const TEXTURES = [
  'smooth',
  'soft',
  'crunchy',
  'chewy',
  'crispy',
  'mixed',
  'lumpy',
  'wet',
  'dry',
] as const;
export const EXPOSURE_STAGES = [
  'tolerate_on_table',
  'look',
  'touch',
  'smell',
  'lick',
  'taste',
  'chew_spit',
  'eat_small',
  'eat_portion',
] as const;
export const ACCEPTANCE_SCORES = [
  '0_refused',
  '1_tolerated',
  '2_touched',
  '3_tasted',
  '4_ate_some',
  '5_ate_well',
] as const;
export const FAST_KINDS = [
  'ramadan',
  'sunnah_monday_thursday',
  'ayyam_al_bid',
  'arafah',
  'ashura',
  'qada',
  'nafl',
  'intermittent',
] as const;
export const PRICE_SOURCES = ['seed', 'user_report', 'admin', 'partner_feed'] as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export type SexAtBirth = (typeof SEXES_AT_BIRTH)[number];
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type LifeStage = (typeof LIFE_STAGES)[number];
export type GoalType = (typeof GOAL_TYPES)[number];
export type SpecialModule = (typeof SPECIAL_MODULES)[number];
export type MealType = (typeof MEAL_TYPES)[number];
export type MealStatus = (typeof MEAL_STATUSES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanKind = (typeof PLAN_KINDS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type EvidenceGradeHadith = (typeof EVIDENCE_GRADES_HADITH)[number];
export type EvidenceGradeScience = (typeof EVIDENCE_GRADES_SCIENCE)[number];
export type SourceTradition = (typeof SOURCE_TRADITIONS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type ChatRole = (typeof CHAT_ROLES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type Texture = (typeof TEXTURES)[number];
export type ExposureStage = (typeof EXPOSURE_STAGES)[number];
export type AcceptanceScore = (typeof ACCEPTANCE_SCORES)[number];
export type FastKind = (typeof FAST_KINDS)[number];
export type PriceSource = (typeof PRICE_SOURCES)[number];
