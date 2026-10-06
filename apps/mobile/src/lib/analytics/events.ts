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
    .object({ step: z.enum(['welcome', 'philosophy', 'consents', 'household', 'members']) })
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
  setting_changed: z
    .object({ key: z.enum(['display_name', 'locale', 'units', 'tradition', 'theme']) })
    .strict(),
} as const;

export type EventName = keyof typeof EventSchemas;
export type EventProps<E extends EventName> = z.infer<(typeof EventSchemas)[E]>;

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EventSchemas, name);
}
