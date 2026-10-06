import { ageInYears, kgToLb, lbToKg, type LifeStage } from '@shared';

import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Adult weight log (FR-TRK-06) and the nutrition journal (02 §7.5.4). Weight is never offered for
 * anyone under 18 (00 §10, enforced in the database as `CHILD_RULE:weight_log`): children's size
 * is followed on growth charts with their parents, not on a scale log.
 */

export const WEIGHT_LOG_KIND = 'weight.log';
export const JOURNAL_SAVE_KIND = 'journal.save';

export interface WeightEntryView {
  id: string;
  familyMemberId: string;
  measuredOn: string;
  weightKg: number;
  waistCm: number | null;
  bmi: number | null;
  queued?: boolean;
}

export interface WeightWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  measuredOn: string;
  weightKg: number;
  waistCm: number | null;
}

export interface JournalEntryView {
  id: string;
  familyMemberId: string;
  journalDate: string;
  mood: number | null;
  energy: number | null;
  digestion: number | null;
  thuluthAdherence: number | null;
  notes: string | null;
  queued?: boolean;
}

export interface JournalWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  journalDate: string;
  mood: number | null;
  energy: number | null;
  digestion: number | null;
  thuluthAdherence: number | null;
  notes: string | null;
}

export interface TrackedMember {
  id: string;
  dateOfBirth: string | null;
  lifeStage: LifeStage | null;
}

const ADULT_STAGES: readonly LifeStage[] = ['adult', 'older_adult'];

/** True only for members known to be 18 or older on `today`. */
export function isAdultMember(m: TrackedMember, today: string): boolean {
  if (m.dateOfBirth) return ageInYears(m.dateOfBirth, today) >= 18;
  return m.lifeStage ? ADULT_STAGES.includes(m.lifeStage) : false;
}

/** The weight log is for adults only; anyone not known to be an adult is treated as a minor. */
export const canLogWeight = isAdultMember;

/**
 * Members under 18 journal without the thirds score: a child's eating is not rated (02 §7.5.4,
 * division of responsibility).
 */
export const journalShowsAdherence = isAdultMember;

/** Display unit; storage is always kg. */
export function toDisplayWeight(kg: number, units: 'metric' | 'imperial'): number {
  return Math.round((units === 'imperial' ? kgToLb(kg) : kg) * 10) / 10;
}

/** Parses typed weight into kg (null when outside the stored range of 20 to 400 kg). */
export function parseWeightKg(text: string, units: 'metric' | 'imperial'): number | null {
  const n = Number(text.replace(',', '.').trim());
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  const kg = Math.round((units === 'imperial' ? lbToKg(n) : n) * 10) / 10;
  return kg >= 20 && kg <= 400 ? kg : null;
}

export function parseWaistCm(text: string): number | null | 'invalid' {
  if (!text.trim()) return null;
  const n = Number(text.replace(',', '.').trim());
  return Number.isFinite(n) && n >= 30 && n <= 250 ? Math.round(n * 10) / 10 : 'invalid';
}

/** Change against the first entry at least `days` ago (null without one). */
export function weightChange(
  entries: readonly WeightEntryView[],
  today: string,
  days = 30,
): number | null {
  const sorted = [...entries].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn));
  const latest = sorted[0];
  if (!latest) return null;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const base = sorted.find((e) => e.measuredOn <= cutoff);
  return base ? Math.round((latest.weightKg - base.weightKg) * 10) / 10 : null;
}

/** One entry per member and day: queued writes replace server rows of the same day. */
export function applyPendingWeights(
  rows: readonly WeightEntryView[],
  outbox: readonly OutboxEntry[],
  familyMemberId: string,
): WeightEntryView[] {
  const byDay = new Map(
    rows.filter((r) => r.familyMemberId === familyMemberId).map((r) => [r.measuredOn, r]),
  );
  for (const e of outbox) {
    if (e.kind !== WEIGHT_LOG_KIND) continue;
    const w = e.payload as WeightWrite;
    if (w.familyMemberId !== familyMemberId) continue;
    byDay.set(w.measuredOn, {
      id: byDay.get(w.measuredOn)?.id ?? w.id,
      familyMemberId: w.familyMemberId,
      measuredOn: w.measuredOn,
      weightKg: w.weightKg,
      waistCm: w.waistCm,
      bmi: null,
      queued: true,
    });
  }
  return [...byDay.values()].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn));
}

export function applyPendingJournal(
  rows: readonly JournalEntryView[],
  outbox: readonly OutboxEntry[],
  familyMemberId: string,
): JournalEntryView[] {
  const byDay = new Map(
    rows.filter((r) => r.familyMemberId === familyMemberId).map((r) => [r.journalDate, r]),
  );
  for (const e of outbox) {
    if (e.kind !== JOURNAL_SAVE_KIND) continue;
    const w = e.payload as JournalWrite;
    if (w.familyMemberId !== familyMemberId) continue;
    byDay.set(w.journalDate, {
      id: byDay.get(w.journalDate)?.id ?? w.id,
      familyMemberId: w.familyMemberId,
      journalDate: w.journalDate,
      mood: w.mood,
      energy: w.energy,
      digestion: w.digestion,
      thuluthAdherence: w.thuluthAdherence,
      notes: w.notes,
      queued: true,
    });
  }
  return [...byDay.values()].sort((a, b) => b.journalDate.localeCompare(a.journalDate));
}
