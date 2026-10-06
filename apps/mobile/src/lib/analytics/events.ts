import { z } from 'zod';

/**
 * Event registry skeleton (docs/18 §9, §10). Props are strict: unknown props fail validation, and the
 * privacy rules in 18 §14 apply (enum values only, no free text, no health values, no child ids).
 * TODO: move to packages/shared/src/analytics/events.ts once the catalog migration (18 §10) lands.
 */
export const EventSchemas = {
  app_opened: z.object({ cold_start: z.boolean() }).strict(),
  screen_viewed: z
    .object({
      screen: z
        .string()
        .regex(/^[A-Za-z]+$/)
        .max(40),
    })
    .strict(),
  locale_changed: z.object({ from: z.enum(['en', 'ur']), to: z.enum(['en', 'ur']) }).strict(),
  debug_test_event: z.object({ source: z.enum(['debug_screen', 'test']) }).strict(),

  // Sprint 1: auth (02 §7.1), onboarding (02 §7.2), household and family (02 §7.8), settings (02 §7.13)
  auth_welcome_cta: z.object({ cta: z.enum(['get_started', 'sign_in']) }).strict(),
  auth_otp_requested: z.object({ mode: z.enum(['sign_in', 'sign_up']) }).strict(),
  auth_otp_resent: z.object({}).strict(),
  auth_otp_verified: z.object({ attempts: z.number().int().min(1).max(10) }).strict(),
  auth_social_started: z.object({ provider: z.enum(['google', 'apple']) }).strict(),
  auth_social_completed: z.object({ provider: z.enum(['google', 'apple']) }).strict(),
  auth_error: z
    .object({
      code: z
        .string()
        .regex(/^[A-Z_]+$/)
        .max(48),
      step: z.enum(['login', 'otp', 'social', 'reviewer']),
    })
    .strict(),
  auth_signed_in: z.object({ method: z.enum(['email', 'google', 'apple', 'restore']) }).strict(),
  auth_signed_out: z.object({ forced: z.boolean() }).strict(),
  onboarding_step_completed: z
    .object({
      step: z.enum([
        'welcome',
        'philosophy',
        'consents',
        'household',
        'members',
        'intake',
        'assessment',
        'first_plan',
      ]),
    })
    .strict(),
  onboarding_completed: z.object({ members: z.number().int().min(0).max(50) }).strict(),
  consent_updated: z
    .object({
      kind: z.enum(['terms', 'privacy', 'health_data', 'child_data', 'ai_processing', 'marketing']),
      granted: z.boolean(),
    })
    .strict(),
  household_created: z.object({ has_budget: z.boolean() }).strict(),
  family_member_added: z
    .object({
      life_stage: z.enum(['infant', 'toddler', 'child', 'teen', 'adult', 'older_adult']),
      source: z.enum(['intake', 'family']),
    })
    .strict(),
  family_member_removed: z.object({}).strict(),
  invite_sent: z.object({ role: z.enum(['caregiver', 'viewer']) }).strict(),
  invite_accepted: z.object({ role: z.enum(['owner', 'caregiver', 'viewer', 'coach']) }).strict(),
  invite_revoked: z.object({}).strict(),
  household_member_removed: z.object({ self: z.boolean() }).strict(),
  // Sprint 2: intake (02 §7.3), assessment (02 §7.4.1), knowledge (02 §7.7.5). Enums and counts only.
  intake_step_completed: z
    .object({
      step: z.enum([
        'household',
        'health',
        'allergies',
        'food',
        'lifestyle',
        'modules',
        'pregnancy',
        'sensory',
        'picky',
        'adhd',
        'goals',
      ]),
    })
    .strict(),
  intake_completed: z
    .object({
      members: z.number().int().min(0).max(50),
      modules: z.array(z.enum(['pregnancy', 'breastfeeding', 'autism', 'adhd', 'picky_eater'])),
      has_red_flags: z.boolean(),
    })
    .strict(),
  ai_assessment_requested: z.object({}).strict(),
  assessment_viewed: z.object({ members: z.number().int().min(0).max(50) }).strict(),
  source_detail_viewed: z
    .object({
      kind: z.enum(['recommendation', 'islamic_source', 'evidence']),
      tradition: z.enum(['shared', 'sunni', 'shia']),
      has_science: z.boolean(),
    })
    .strict(),
  evidence_link_opened: z.object({}).strict(),
  // Sprint 3: plans (02 §7.4.2, §7.6), Today (02 §7.5), logging and swap (02 §5.5), alpha feedback.
  plan_generate_requested: z
    .object({
      kind: z.enum(['standard', 'growth', 'weight_management', 'custom']),
      weeks: z.number().int().min(1).max(4),
      source: z.enum(['onboarding', 'plans', 'retry', 'template']),
    })
    .strict(),
  plan_generation_completed: z
    .object({
      duration_ms: z.number().int().min(0),
      status: z.enum(['draft', 'active']),
      mode: z.enum(['full', 'template_personalize', 'unknown']),
    })
    .strict(),
  plan_generation_failed: z
    .object({
      code: z
        .string()
        .regex(/^[A-Z_]+$/)
        .max(48),
    })
    .strict(),
  plan_viewed: z
    .object({
      kind: z.enum(['standard', 'ramadan', 'growth', 'weight_management', 'custom']),
      week_index: z.number().int().min(0).max(12),
    })
    .strict(),
  meal_detail_viewed: z
    .object({ meal_type: z.enum(['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar']) })
    .strict(),
  meal_serving_logged: z
    .object({
      status: z.enum(['planned', 'eaten', 'partly_eaten', 'skipped', 'swapped']),
      has_acceptance: z.boolean(),
      meal_type: z.enum(['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar']),
      life_stage: z.enum(['infant', 'toddler', 'child', 'teen', 'adult', 'older_adult']),
    })
    .strict(),
  meal_bulk_logged: z
    .object({
      daily_meal_id_count: z.number().int().min(0).max(50),
      source: z.enum(['dashboard', 'meal_detail']),
    })
    .strict(),
  meal_swapped: z
    .object({
      reason: z.enum(['allergy', 'budget', 'autism', 'picky', 'season', 'preference', 'ai']),
      source: z.enum(['catalog', 'ai']),
    })
    .strict(),
  recipe_opened: z.object({ recipe_source: z.enum(['curated', 'ai_generated', 'user']) }).strict(),
  recommendation_opened: z.object({ surface: z.enum(['dashboard', 'plan', 'recipe']) }).strict(),
  dashboard_section_tapped: z
    .object({
      section: z.enum([
        'meals',
        'tip',
        'quick_log',
        'plan',
        'feedback',
        'hydration',
        'budget',
        'grocery',
        'fasting',
        'notifications',
      ]),
    })
    .strict(),
  alpha_feedback_sent: z
    .object({ category: z.enum(['bug', 'idea', 'content', 'other']), has_screen: z.boolean() })
    .strict(),
  setting_changed: z
    .object({
      key: z.enum([
        'display_name',
        'locale',
        'units',
        'tradition',
        'theme',
        'notifications',
        'quiet_hours',
        'budget',
      ]),
    })
    .strict(),
  // Sprint 4: grocery and budget (02 §7.6.6 to §7.6.8, §7.12.9), trackers (02 §7.12.2 to §7.12.5),
  // notifications (02 §7.13.1, §7.2.6), weight log and journal (02 §7.5.4). Enums and counts only.
  grocery_generate_requested: z
    .object({ source: z.enum(['lists', 'plan', 'dashboard']), optimize: z.boolean() })
    .strict(),
  grocery_item_checked: z.object({ source: z.enum(['detail', 'shopping']) }).strict(),
  grocery_item_added: z.object({}).strict(),
  grocery_list_shared: z.object({ items: z.number().int().min(0).max(500) }).strict(),
  grocery_substitution_viewed: z.object({ premium: z.boolean() }).strict(),
  shopping_started: z.object({}).strict(),
  shopping_finished: z
    .object({
      items: z.number().int().min(0).max(500),
      checked: z.number().int().min(0).max(500),
      has_actuals: z.boolean(),
    })
    .strict(),
  price_reported: z.object({ count: z.number().int().min(0).max(500) }).strict(),
  budget_viewed: z.object({ month_offset: z.number().int().min(-24).max(1) }).strict(),
  budget_entry_added: z
    .object({
      category: z
        .string()
        .regex(/^[a-z_]+$/)
        .max(32),
      source: z.enum(['manual', 'grocery']),
    })
    .strict(),
  hydration_logged: z
    .object({
      volume_ml_bucket: z.enum(['lt150', '150_249', '250_499', '500_plus']),
      beverage: z.enum(['water', 'milk', 'laban', 'juice', 'tea', 'other']),
      timing: z.enum(['pre_meal', 'with_meal', 'post_meal', 'other']),
      members_count: z.number().int().min(1).max(20),
    })
    .strict(),
  hydration_symptom_check: z.object({ red_flag: z.boolean(), fasting: z.boolean() }).strict(),
  fast_logged: z
    .object({
      kind: z.enum([
        'ramadan',
        'sunnah_monday_thursday',
        'ayyam_al_bid',
        'arafah',
        'ashura',
        'qada',
        'nafl',
        'intermittent',
      ]),
      completed: z.boolean(),
      has_exemption: z.boolean(),
      practice: z.boolean(),
    })
    .strict(),
  fasting_blocked: z
    .object({ reason: z.enum(['under_7', 'clinician', 'intermittent_minor']) })
    .strict(),
  push_permission_result: z.object({ granted: z.boolean() }).strict(),
  push_preprompt: z.object({ action: z.enum(['shown', 'allow', 'not_now']) }).strict(),
  notification_opened: z
    .object({
      kind: z
        .string()
        .regex(/^[a-z_]+$/)
        .max(40),
      channel: z.enum(['push', 'in_app']),
    })
    .strict(),
  weight_logged: z.object({ has_waist: z.boolean() }).strict(),
  reflection_saved: z
    .object({
      thuluth_adherence: z.number().int().min(0).max(3).nullable(),
      has_notes: z.boolean(),
      minor: z.boolean(),
    })
    .strict(),
} as const;

export type EventName = keyof typeof EventSchemas;
export type EventProps<E extends EventName> = z.infer<(typeof EventSchemas)[E]>;

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EventSchemas, name);
}
