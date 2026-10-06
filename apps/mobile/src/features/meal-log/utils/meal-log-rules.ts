import { MEAL_TYPES, type MealType } from '@shared';
import type { AiAnalyzeMealResponse } from '@shared/contracts';

import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Meal logs (FR-TRK-02, -03, 02 §7.7.3 to §7.7.4, 05 §12.1). Pure rules for the photo analysis
 * result, its correction and the `meal_logs` write. Child rule (00 §10, 02 §1.1): for anyone under
 * 18 no kcal, macros or grams are ever rendered or stored, whatever the server returns.
 */

export const MEAL_LOG_KIND = 'meal_log.upsert';

export type MealLogSource = 'manual' | 'photo_ai';

/** Outbox payload; `id` is the row id and the idempotency key. */
export interface MealLogWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  eatenAt: string;
  mealType: MealType;
  description: string;
  photoPath: string | null;
  estimatedNutrition: Record<string, unknown>;
  fullnessBefore: number | null;
  fullnessAfter: number | null;
  source: MealLogSource;
  loggedByUserId: string | null;
}

/** Default meal type by the household's local time (02 §7.12.6 "default by time"). */
export function mealTypeForMinutes(minutes: number, ramadan = false): MealType {
  if (ramadan) return minutes < 8 * 60 ? 'suhoor' : minutes >= 17 * 60 ? 'iftar' : 'snack';
  if (minutes < 11 * 60) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes < 18 * 60) return 'snack';
  return 'dinner';
}
export const LOGGABLE_MEAL_TYPES: readonly MealType[] = MEAL_TYPES;

export interface EditableItem {
  key: string;
  label: string;
  grams: number;
  measure: string | null;
  /** "Sure" from 0.5 up; numbers are never shown (02 §7.7.4 "Sure / Not sure"). */
  sure: boolean;
  included: boolean;
  added: boolean;
}

export const LOW_CONFIDENCE = 0.5;

/** Items with confidence below 0.5 start unchecked (12 §14). */
export function editableItems(res: Pick<AiAnalyzeMealResponse, 'items'>): EditableItem[] {
  return res.items.map((i, idx) => ({
    key: `item-${idx}`,
    label: i.label,
    grams: Math.round(i.estimated_grams),
    measure: i.household_measure ?? null,
    sure: i.confidence >= LOW_CONFIDENCE,
    included: i.confidence >= LOW_CONFIDENCE,
    added: false,
  }));
}

/** Whether numbers (kcal, macros, grams) may be shown: both the server flag and the member's age. */
export function canShowNumbers(res: Pick<AiAnalyzeMealResponse, 'show_numbers'>, minor: boolean) {
  return res.show_numbers && !minor;
}

export interface AnalysisView {
  showNumbers: boolean;
  nutrition: AiAnalyzeMealResponse['nutrition'];
  confidence: 'low' | 'medium' | 'high';
  feedback: AiAnalyzeMealResponse['thuluth_feedback'];
  plate: AiAnalyzeMealResponse['plate_split'];
}

export function confidenceBucket(c: number): 'low' | 'medium' | 'high' {
  if (c < 0.5) return 'low';
  if (c < 0.75) return 'medium';
  return 'high';
}

/** What the result screen may render. For a minor `nutrition` is always null. */
export function analysisView(res: AiAnalyzeMealResponse, minor: boolean): AnalysisView {
  const showNumbers = canShowNumbers(res, minor);
  return {
    showNumbers,
    nutrition: showNumbers ? res.nutrition : null,
    confidence: confidenceBucket(res.overall_confidence),
    feedback: res.thuluth_feedback,
    plate: res.plate_split,
  };
}

/** Number of user edits compared to the original items (analytics `meal_analysis_edited`). */
export function countEdits(original: readonly EditableItem[], edited: readonly EditableItem[]) {
  let edits = 0;
  for (const e of edited) {
    const o = original.find((x) => x.key === e.key);
    if (!o) {
      edits += 1;
      continue;
    }
    if (o.label !== e.label || o.grams !== e.grams || o.included !== e.included) edits += 1;
  }
  return Math.min(50, edits);
}

const NUMBER_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fiber_g',
  'sugar_g',
  'fat_g',
  'sat_fat_g',
  'sodium_mg',
  'iron_mg',
  'calcium_mg',
] as const;

/**
 * `meal_logs.estimated_nutrition` (05 §12.1). For adults the server estimate is scaled by the
 * edited total grams (a removed or resized item changes the estimate proportionally). For minors
 * only labels and the plate split are stored: no grams and no numbers.
 */
export function estimatedNutrition(
  res: AiAnalyzeMealResponse,
  items: readonly EditableItem[],
  minor: boolean,
): Record<string, unknown> {
  const kept = items.filter((i) => i.included && i.label.trim().length > 0);
  const base = {
    analysis_id: res.analysis_id,
    plate_split: res.plate_split,
    thuluth_feedback: res.thuluth_feedback.headline,
  };
  if (!canShowNumbers(res, minor))
    return { ...base, items: kept.map((i) => ({ label: i.label.trim(), sure: i.sure })) };
  const original = res.items.reduce((n, i) => n + i.estimated_grams, 0);
  const edited = kept.reduce((n, i) => n + i.grams, 0);
  const scale = original > 0 ? edited / original : 0;
  const numbers: Record<string, number> = {};
  if (res.nutrition)
    for (const k of NUMBER_KEYS) {
      const v = res.nutrition[k];
      if (typeof v === 'number') numbers[k] = Math.round(v * scale * 10) / 10;
    }
  return {
    ...base,
    items: kept.map((i) => ({ label: i.label.trim(), grams: i.grams, sure: i.sure })),
    ...numbers,
  };
}

/** A readable description from the kept items ("Chapati, chicken karahi") plus the note. */
export function describeItems(items: readonly EditableItem[], note: string): string {
  const labels = items
    .filter((i) => i.included && i.label.trim())
    .map((i) => i.label.trim())
    .join(', ');
  return [labels, note.trim()].filter(Boolean).join(' · ').slice(0, 2000);
}

/** Fullness scores are adults only (02 §7.12.6); children never get the 0 to 10 sliders. */
export function fullnessFor(minor: boolean, value: number | null): number | null {
  if (minor || value === null) return null;
  return Math.max(0, Math.min(10, Math.round(value)));
}

export function applyPendingMealLogs(
  logs: readonly MealLogWrite[],
  entries: readonly OutboxEntry[],
): Array<MealLogWrite & { queued?: boolean }> {
  const byId = new Map<string, MealLogWrite & { queued?: boolean }>(logs.map((l) => [l.id, l]));
  for (const e of entries)
    if (e.kind === MEAL_LOG_KIND) {
      const w = e.payload as MealLogWrite;
      byId.set(w.id, { ...w, queued: true });
    }
  return [...byId.values()].sort((a, b) => b.eatenAt.localeCompare(a.eatenAt));
}
