import { NutritionJournalInput, WeightLogInput } from '@shared/domain/tracking';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type {
  JournalEntryView,
  JournalWrite,
  WeightEntryView,
  WeightWrite,
} from '../utils/tracking-rules';

/**
 * Weight log and nutrition journal through PostgREST (05 §10). One row per member and day, so
 * writes upsert on that key: a replay or an edit later the same day updates the row.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export async function fetchWeights(familyMemberId: string): Promise<WeightEntryView[]> {
  const { data, error } = await client()
    .from('weight_tracking')
    .select('id, family_member_id, measured_on, weight_kg, waist_cm, bmi')
    .eq('family_member_id', familyMemberId)
    .order('measured_on', { ascending: false })
    .limit(120);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    familyMemberId: r.family_member_id,
    measuredOn: r.measured_on,
    weightKg: Number(r.weight_kg),
    waistCm: r.waist_cm === null ? null : Number(r.waist_cm),
    bmi: r.bmi === null ? null : Number(r.bmi),
  }));
}

export async function upsertWeight(w: WeightWrite): Promise<void> {
  const parsed = WeightLogInput.parse({
    id: w.id,
    measured_on: w.measuredOn,
    weight_kg: w.weightKg,
    waist_cm: w.waistCm,
  });
  const { error } = await client()
    .from('weight_tracking')
    .upsert(
      {
        id: parsed.id,
        household_id: w.householdId,
        family_member_id: w.familyMemberId,
        measured_on: parsed.measured_on,
        weight_kg: parsed.weight_kg,
        waist_cm: parsed.waist_cm ?? null,
      },
      { onConflict: 'family_member_id,measured_on' },
    );
  if (error) throw toDbAppError(error);
}

export async function fetchJournal(
  familyMemberId: string,
  since: string,
): Promise<JournalEntryView[]> {
  const { data, error } = await client()
    .from('nutrition_journal')
    .select('id, family_member_id, journal_date, mood, energy, digestion, thuluth_adherence, notes')
    .eq('family_member_id', familyMemberId)
    .gte('journal_date', since)
    .order('journal_date', { ascending: false });
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    familyMemberId: r.family_member_id,
    journalDate: r.journal_date,
    mood: r.mood,
    energy: r.energy,
    digestion: r.digestion,
    thuluthAdherence: r.thuluth_adherence,
    notes: r.notes,
  }));
}

export async function upsertJournal(w: JournalWrite): Promise<void> {
  const parsed = NutritionJournalInput.parse({
    id: w.id,
    journal_date: w.journalDate,
    mood: w.mood,
    energy: w.energy,
    digestion: w.digestion,
    thuluth_adherence: w.thuluthAdherence,
    notes: w.notes,
  });
  const { error } = await client()
    .from('nutrition_journal')
    .upsert(
      {
        id: parsed.id,
        household_id: w.householdId,
        family_member_id: w.familyMemberId,
        journal_date: parsed.journal_date,
        mood: parsed.mood ?? null,
        energy: parsed.energy ?? null,
        digestion: parsed.digestion ?? null,
        thuluth_adherence: parsed.thuluth_adherence ?? null,
        notes: parsed.notes ?? null,
      },
      { onConflict: 'family_member_id,journal_date' },
    );
  if (error) throw toDbAppError(error);
}
