import type { NotificationKind } from './notification-routing';

/** Settings groups (02 §7.13.5); every kind of 06 §4.15 appears exactly once. */
export const NOTIFICATION_GROUPS: ReadonlyArray<{
  key: string;
  kinds: readonly NotificationKind[];
}> = [
  {
    key: 'daily',
    kinds: [
      'daily_plan',
      'meal_reminder',
      'meal_log_prompt',
      'hydration_reminder',
      'journal_prompt',
    ],
  },
  { key: 'plan', kinds: ['plan_ready', 'plan_failed', 'grocery_day', 'weekly_review'] },
  { key: 'fasting', kinds: ['suhoor_reminder', 'iftar_reminder', 'fasting_sunnah_reminder'] },
  {
    key: 'children',
    kinds: [
      'growth_alert',
      'allergy_warning',
      'growth_measure_due',
      'exposure_nudge',
      'coaching_tip',
    ],
  },
  {
    key: 'account',
    kinds: ['invite_received', 'invite_accepted', 'export_ready', 'trial_ending', 'billing_issue'],
  },
  { key: 'news', kinds: ['marketing'] },
];

/** Child safety alerts cannot be switched off (DB constraint `notification_preferences_safety_always_on`). */
export const ALWAYS_ON_KINDS: ReadonlySet<string> = new Set(['growth_alert', 'allergy_warning']);

/** Off by default (`notification_default_enabled`). */
export const DEFAULT_OFF_KINDS: ReadonlySet<string> = new Set([
  'meal_reminder',
  'meal_log_prompt',
  'journal_prompt',
  'fasting_sunnah_reminder',
  'marketing',
]);

/** FR-NOT-02: the fasting schedule is not held back by quiet hours. */
export const QUIET_EXEMPT_KINDS: ReadonlySet<NotificationKind> = new Set([
  'suhoor_reminder',
  'iftar_reminder',
]);

export function isValidHhmm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
