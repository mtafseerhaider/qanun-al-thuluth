import type { z } from 'zod';

import { AiIntakeAssessRequest, AiIntakeAssessResponse } from '@shared/contracts';
import {
  AllergyInput,
  FoodDislikeInput,
  FoodPreferenceInput,
  HouseholdPreferences,
  MedicalConditionInput,
  medicationFlagsFor,
  MedicationInput,
  MemberLifestyle,
  NutritionGoalInput,
  PregnancyProfileInput,
  type RedFlagScreening,
  SensoryProfileInput,
  SupplementInput,
} from '@shared/domain/intake';
import {
  onInsulinOrSulfonylurea,
  type ConditionDraft,
  type MedicationDraft,
} from '@shared/intake/questions';
import type { SpecialModule } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Intake writes for onboarding step 5 (01 §7, 05 §8). Every row carries a client id generated in
 * the draft, so saving a step twice is idempotent: rows are upserted by id and rows the user removed
 * are soft-deleted through the `soft_delete` RPC (05 §14.3).
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

type MemberTable =
  | 'medical_conditions'
  | 'medications'
  | 'supplements'
  | 'allergies'
  | 'food_preferences'
  | 'food_dislikes'
  | 'nutrition_goals';

export interface MemberRef {
  householdId: string;
  familyMemberId: string;
}

/** Live row ids for a member, optionally narrowed by `is_safe_food` for `food_preferences`. */
async function liveIds(table: MemberTable, ref: MemberRef, safeFood?: boolean): Promise<string[]> {
  const { data, error } =
    safeFood === undefined
      ? await client()
          .from(table)
          .select('id')
          .eq('household_id', ref.householdId)
          .eq('family_member_id', ref.familyMemberId)
          .is('deleted_at', null)
      : await client()
          .from('food_preferences')
          .select('id')
          .eq('household_id', ref.householdId)
          .eq('family_member_id', ref.familyMemberId)
          .eq('is_safe_food', safeFood)
          .is('deleted_at', null);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function softDelete(table: string, id: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', { p_table: table, p_id: id });
  if (error) throw toDbAppError(error);
}

/**
 * Makes the member's live rows in `table` equal `rows`: soft-deletes the ones not in the list, then
 * upserts the rest in order (callers order rows so a partial unique index is never violated).
 */
export async function replaceMemberRows(
  table: MemberTable,
  ref: MemberRef,
  rows: ReadonlyArray<{ id: string } & Record<string, unknown>>,
  opts: { safeFood?: boolean } = {},
): Promise<void> {
  const keep = new Set(rows.map((r) => r.id));
  const existing = await liveIds(table, ref, opts.safeFood);
  for (const id of existing) if (!keep.has(id)) await softDelete(table, id);
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    ...r,
    household_id: ref.householdId,
    family_member_id: ref.familyMemberId,
  }));
  // Rows are sent one at a time when order matters (goals); otherwise in one request.
  const { error } = await client()
    .from(table)
    .upsert(payload as never, { onConflict: 'id' });
  if (error) throw toDbAppError(error);
}

/** Strips the draft-only fields and validates with the domain schema. */
function rowsOf<S extends z.ZodTypeAny>(
  schema: S,
  items: ReadonlyArray<{ id: string } & Record<string, unknown>>,
) {
  return items.map(({ id, ...rest }) => ({ id, ...(schema.parse(rest) as object) }));
}

// Household preferences (01 §7.1) ------------------------------------------------------------

export async function saveHouseholdPreferences(
  householdId: string,
  input: z.input<typeof HouseholdPreferences>,
): Promise<void> {
  const preferences = HouseholdPreferences.parse(input);
  const { error } = await client()
    .from('households')
    .update({ preferences } as never)
    .eq('id', householdId);
  if (error) throw toDbAppError(error);
}

// Health (01 §7.3) ---------------------------------------------------------------------------

/** Medication flags are set by the app from the name (01 §7.3, `medicationFlagsFor`). */
export function withMedicationFlags(m: MedicationDraft): MedicationDraft {
  return { ...m, food_interaction_flags: medicationFlagsFor(m.name) };
}

export async function saveHealth(
  ref: MemberRef,
  input: {
    conditions: ConditionDraft[];
    medications: MedicationDraft[];
    supplements: Array<{
      id: string;
      name: string;
      dose?: string | null | undefined;
      frequency?: string | null | undefined;
    }>;
  },
): Promise<void> {
  const meds = input.medications.map(withMedicationFlags);
  await replaceMemberRows('medications', ref, rowsOf(MedicationInput, meds));
  const conditions = input.conditions.map((c) => ({
    ...c,
    on_insulin_or_sulfonylurea: onInsulinOrSulfonylurea(c, meds),
  }));
  await replaceMemberRows('medical_conditions', ref, rowsOf(MedicalConditionInput, conditions));
  await replaceMemberRows('supplements', ref, rowsOf(SupplementInput, input.supplements));
}

export async function saveMedications(ref: MemberRef, medications: MedicationDraft[]) {
  await replaceMemberRows(
    'medications',
    ref,
    rowsOf(MedicationInput, medications.map(withMedicationFlags)),
  );
}

export async function saveAllergies(
  ref: MemberRef,
  items: Array<{ id: string } & z.input<typeof AllergyInput>>,
): Promise<void> {
  await replaceMemberRows('allergies', ref, rowsOf(AllergyInput, items));
}

// Food (01 §7.4) ----------------------------------------------------------------------------

type PrefDraft = { id: string } & z.input<typeof FoodPreferenceInput>;
type DislikeDraft = { id: string } & z.input<typeof FoodDislikeInput>;

/** Likes are `is_safe_food = false`; safe foods (picky / autism) are managed separately. */
export async function saveLikes(ref: MemberRef, likes: PrefDraft[]): Promise<void> {
  const rows = likes.map((l) => ({ ...l, is_safe_food: false }));
  await replaceMemberRows('food_preferences', ref, rowsOf(FoodPreferenceInput, rows), {
    safeFood: false,
  });
}

export async function saveSafeFoods(ref: MemberRef, safeFoods: PrefDraft[]): Promise<void> {
  const rows = safeFoods.map((l) => ({ ...l, is_safe_food: true }));
  await replaceMemberRows('food_preferences', ref, rowsOf(FoodPreferenceInput, rows), {
    safeFood: true,
  });
}

export async function saveDislikes(ref: MemberRef, dislikes: DislikeDraft[]): Promise<void> {
  await replaceMemberRows('food_dislikes', ref, rowsOf(FoodDislikeInput, dislikes));
}

// Member columns: lifestyle (Addition) and special modules ------------------------------------

export async function saveMemberColumns(
  familyMemberId: string,
  patch: { lifestyle?: z.input<typeof MemberLifestyle>; special_modules?: SpecialModule[] },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.lifestyle !== undefined) update.lifestyle = MemberLifestyle.parse(patch.lifestyle);
  if (patch.special_modules !== undefined) update.special_modules = patch.special_modules;
  const { error } = await client()
    .from('family_members')
    .update(update as never)
    .eq('id', familyMemberId);
  if (error) throw toDbAppError(error);
}

// One-live-row tables: pregnancy_profiles, sensory_profiles -----------------------------------

/**
 * Upsert by the draft id; if another live row already exists for the member (created on another
 * device), that row is updated instead (partial unique index `*_one_live`).
 */
async function upsertOneLive(
  table: 'pregnancy_profiles' | 'sensory_profiles',
  ref: MemberRef,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { data, error: readError } = await client()
    .from(table)
    .select('id')
    .eq('family_member_id', ref.familyMemberId)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError) throw toDbAppError(readError);
  const existing = (data as { id: string } | null)?.id;
  const row = {
    ...values,
    id: existing ?? id,
    household_id: ref.householdId,
    family_member_id: ref.familyMemberId,
  };
  const { error } = await client()
    .from(table)
    .upsert(row as never, { onConflict: 'id' });
  if (error) throw toDbAppError(error);
}

export async function removeOneLive(
  table: 'pregnancy_profiles' | 'sensory_profiles',
  ref: MemberRef,
): Promise<void> {
  const { data, error } = await client()
    .from(table)
    .select('id')
    .eq('family_member_id', ref.familyMemberId)
    .is('deleted_at', null);
  if (error) throw toDbAppError(error);
  for (const r of (data ?? []) as { id: string }[]) await softDelete(table, r.id);
}

export async function savePregnancy(
  ref: MemberRef,
  draft: { id: string } & z.input<typeof PregnancyProfileInput>,
): Promise<void> {
  const { id, ...rest } = draft;
  const parsed = PregnancyProfileInput.parse({
    trimester: rest.trimester ?? null,
    due_date: rest.due_date ?? null,
    gestational_diabetes: rest.gestational_diabetes ?? false,
  });
  await upsertOneLive('pregnancy_profiles', ref, id, parsed);
}

export async function saveSensory(
  ref: MemberRef,
  draft: { id: string } & z.input<typeof SensoryProfileInput>,
): Promise<void> {
  const { id, ...rest } = draft;
  await upsertOneLive('sensory_profiles', ref, id, SensoryProfileInput.parse(rest));
}

// Goals (01 §7.5) ---------------------------------------------------------------------------

export async function saveGoals(
  ref: MemberRef,
  goals: Array<{ id: string } & z.input<typeof NutritionGoalInput>>,
): Promise<void> {
  const rows = rowsOf(NutritionGoalInput, goals) as Array<{ id: string; is_primary: boolean }>;
  // Non-primary first, then the primary: the one-primary partial unique index never trips.
  const ordered = [...rows.filter((g) => !g.is_primary), ...rows.filter((g) => g.is_primary)];
  const keep = new Set(ordered.map((r) => r.id));
  for (const id of await liveIds('nutrition_goals', ref))
    if (!keep.has(id)) await softDelete('nutrition_goals', id);
  for (const row of ordered) await replaceOne('nutrition_goals', ref, row);
}

async function replaceOne(
  table: MemberTable,
  ref: MemberRef,
  row: { id: string } & Record<string, unknown>,
): Promise<void> {
  const { error } = await client()
    .from(table)
    .upsert(
      { ...row, household_id: ref.householdId, family_member_id: ref.familyMemberId } as never,
      { onConflict: 'id' },
    );
  if (error) throw toDbAppError(error);
}

// Assessment (06 §4.2) ------------------------------------------------------------------------

export function runIntakeAssessment(input: {
  householdId: string;
  locale: 'en' | 'ur';
  screening: Record<string, RedFlagScreening>;
}): Promise<AiIntakeAssessResponse> {
  const request = AiIntakeAssessRequest.parse({
    household_id: input.householdId,
    reason: 'onboarding',
    locale: input.locale,
    red_flag_screening: input.screening,
  });
  return invokeEdge('ai-intake-assess', request, AiIntakeAssessResponse);
}

// Allergens catalog (05 §7.1, seeded EU-14 + US Big-9) --------------------------------------

export interface Allergen {
  id: string;
  code: string;
  name_i18n: Record<string, string>;
  eu14: boolean;
  us_big9: boolean;
}

export async function listAllergens(): Promise<Allergen[]> {
  const { data, error } = await client()
    .from('allergens')
    .select('id, code, name_i18n, eu14, us_big9')
    .order('code', { ascending: true });
  if (error) throw toDbAppError(error);
  return (data ?? []) as unknown as Allergen[];
}
