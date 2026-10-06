import { z } from 'zod';

import { FAST_KINDS, MEAL_TYPES, type FastKind, type MealType } from '@shared';
import { BEVERAGES, DRINK_TIMINGS } from '@shared/domain/tracking';

import type { ChatProposal, ProposalCard } from './chat-stream';

/**
 * Tool confirmation cards (FR-CHAT-06, 06 §4.1 "write tools never execute server-side", 12 §10.3).
 * A proposal is turned into a concrete, validated action here; the screen shows it, and only the
 * user's "Confirm" tap runs it. Log proposals become outbox writes (offline-safe, idempotent);
 * plan adjustments call `ai-adjust-plan` (premium). Unknown or malformed values yield
 * `unsupported`, which renders without a confirm button.
 */

const Uuid = z.string().uuid();
const Instant = z.string().datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const HydrationValues = z.object({
  family_member_id: Uuid,
  volume_ml: z.number().int().min(10).max(3000),
  beverage: z.enum(BEVERAGES).default('water'),
  timing: z.enum(DRINK_TIMINGS).optional(),
  logged_at: Instant.optional(),
});

const MealLogValues = z.object({
  family_member_id: Uuid,
  meal_type: z.enum(MEAL_TYPES),
  description: z.string().trim().min(2).max(500),
  eaten_at: Instant.optional(),
  fullness_before: z.number().int().min(0).max(10).nullable().optional(),
  fullness_after: z.number().int().min(0).max(10).nullable().optional(),
});

const FastingValues = z.object({
  family_member_id: Uuid,
  fast_date: IsoDate,
  kind: z.enum(FAST_KINDS),
  completed: z.boolean().default(true),
  is_practice_fast: z.boolean().default(false),
});

export type ProposalAction =
  | {
      kind: 'hydration';
      memberId: string;
      volumeMl: number;
      beverage: (typeof BEVERAGES)[number];
      timing?: (typeof DRINK_TIMINGS)[number];
      at?: string;
    }
  | {
      kind: 'meal_log';
      memberId: string;
      mealType: MealType;
      description: string;
      eatenAt?: string;
      fullnessBefore: number | null;
      fullnessAfter: number | null;
    }
  | {
      kind: 'fast';
      memberId: string;
      fastDate: string;
      fastKind: FastKind;
      completed: boolean;
      practice: boolean;
    }
  | { kind: 'plan_adjust'; mealPlanId: string; changeRequest: string; scopeSummary: string }
  | { kind: 'unsupported'; reason: 'invalid' | 'not_available' };

export function proposalAction(card: ProposalCard): ProposalAction {
  if (card.kind === 'plan_adjustment_proposal') {
    if (!Uuid.safeParse(card.meal_plan_id).success || card.change_request.trim().length < 3)
      return { kind: 'unsupported', reason: 'invalid' };
    return {
      kind: 'plan_adjust',
      mealPlanId: card.meal_plan_id,
      changeRequest: card.change_request.trim().slice(0, 1000),
      scopeSummary: card.scope_summary,
    };
  }
  switch (card.table) {
    case 'hydration_logs': {
      const v = HydrationValues.safeParse(card.values);
      if (!v.success) return { kind: 'unsupported', reason: 'invalid' };
      return {
        kind: 'hydration',
        memberId: v.data.family_member_id,
        volumeMl: v.data.volume_ml,
        beverage: v.data.beverage,
        ...(v.data.timing ? { timing: v.data.timing } : {}),
        ...(v.data.logged_at ? { at: v.data.logged_at } : {}),
      };
    }
    case 'meal_logs': {
      const v = MealLogValues.safeParse(card.values);
      if (!v.success) return { kind: 'unsupported', reason: 'invalid' };
      return {
        kind: 'meal_log',
        memberId: v.data.family_member_id,
        mealType: v.data.meal_type,
        description: v.data.description,
        ...(v.data.eaten_at ? { eatenAt: v.data.eaten_at } : {}),
        fullnessBefore: v.data.fullness_before ?? null,
        fullnessAfter: v.data.fullness_after ?? null,
      };
    }
    case 'fasting_logs': {
      const v = FastingValues.safeParse(card.values);
      if (!v.success) return { kind: 'unsupported', reason: 'invalid' };
      return {
        kind: 'fast',
        memberId: v.data.family_member_id,
        fastDate: v.data.fast_date,
        fastKind: v.data.kind,
        completed: v.data.completed,
        practice: v.data.is_practice_fast,
      };
    }
    default:
      // food_exposures: the exposure log screen arrives with the picky-eater module (Sprint 6).
      return { kind: 'unsupported', reason: 'not_available' };
  }
}

/**
 * Child rules applied to a confirmed log (00 §10, 12 §8.11): fullness scores are dropped for
 * members under 18, and fasts are never logged for members under 7 (practice only from 7).
 */
export function guardForMember(
  action: ProposalAction,
  member: { ageYears: number | null; minor: boolean } | null,
): ProposalAction {
  if (!member) return { kind: 'unsupported', reason: 'invalid' };
  if (action.kind === 'meal_log' && member.minor)
    return { ...action, fullnessBefore: null, fullnessAfter: null };
  if (action.kind === 'fast') {
    const under7 = member.ageYears === null ? member.minor : member.ageYears < 7;
    if (under7) return { kind: 'unsupported', reason: 'invalid' };
    if (member.ageYears !== null && member.ageYears < 13) return { ...action, practice: true };
  }
  return action;
}

/** Whether the card shows Confirm / Not now (pending and actionable only). */
export function canConfirm(p: ChatProposal, action: ProposalAction, canEdit: boolean): boolean {
  return p.status === 'pending' && canEdit && action.kind !== 'unsupported';
}
