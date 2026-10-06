import { escalationFor } from '../guardrails/red-flags.ts';
import type { EscalationOut, EscalationReason, Recommend } from '../guardrails/red-flags.ts';
import type { Locale } from '../guardrails/text.ts';

/**
 * Planning stops from stored risk flags (00 §10.2, 12 §11 S1, 15 §8). `ai_assessments.risk_flags`
 * holds hard flags as `red_flag.<code>` (S2 intake). A stop-all flag blocks plan generation for the
 * household until a caregiver resolves the matching `safety_events` row; weight-goal stops drop the
 * member's weight goal from planning.
 */

const STOP_ALL: Record<
  string,
  { reason: (minor: boolean) => EscalationReason; recommend: (minor: boolean) => Recommend }
> = {
  child_rapid_weight_loss: {
    reason: () => 'rapid_child_weight_loss',
    recommend: () => 'see_pediatrician',
  },
  feeding_losing_foods: {
    reason: (minor) => (minor ? 'rapid_child_weight_loss' : 'other_clinical'),
    recommend: (minor) => (minor ? 'see_pediatrician' : 'see_gp'),
  },
  pregnancy_warning_sign: {
    reason: () => 'pregnancy_complication',
    recommend: () => 'urgent_care',
  },
  faltering_growth: { reason: () => 'faltering_growth', recommend: () => 'see_pediatrician' },
};

const STOP_WEIGHT_GOALS = new Set(['eating_disorder_signal', 'unintended_weight_loss']);

export interface PlanningStops {
  escalation: EscalationOut | null;
  stopWeightGoals: boolean;
}

export function planningStops(
  riskFlags: readonly string[],
  opts: { memberId: string; minor: boolean; locale: Locale; acknowledged: boolean },
): PlanningStops {
  const hard = riskFlags.filter((f) => f.startsWith('red_flag.')).map((f) => f.slice(9));
  const stopWeightGoals = hard.some((c) => STOP_WEIGHT_GOALS.has(c));
  if (opts.acknowledged) return { escalation: null, stopWeightGoals };
  for (const code of hard) {
    const rule = STOP_ALL[code];
    if (!rule) continue;
    const reason = rule.reason(opts.minor);
    const escalation = escalationFor(
      [
        {
          code,
          hard: true,
          severity: 'see_clinician',
          stops: 'all',
          reason,
          recommend: rule.recommend(opts.minor),
          evidence: {},
        },
      ],
      opts.memberId,
      opts.locale,
    );
    return { escalation, stopWeightGoals };
  }
  return { escalation: null, stopWeightGoals };
}
