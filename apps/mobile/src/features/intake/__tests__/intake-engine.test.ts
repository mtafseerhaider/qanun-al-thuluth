import { CONDITION_OPTIONS } from '@shared/intake/catalog';
import {
  completeness,
  householdCompleteness,
  INTAKE_SCHEMA_VERSION,
  intakeContext,
  intakeRedFlags,
  nextIntakeStep,
  screeningFor,
  visibleSteps,
  type IntakeMemberProfile,
  type MemberIntakeStep,
} from '@shared/intake/questions';

import {
  DRAFT_MAX_AGE_MS,
  initialIntakeDraft,
  migrateIntakeDraft,
  useIntakeDraftStore,
} from '../store/use-intake-draft-store';
import { memberStepTarget } from '../utils/intake-routes';

const TODAY = '2026-10-06';
const HH = '00000000-0000-4000-8000-0000000000aa';
const USMAN = '00000000-0000-4000-8000-000000000001';
const MARYAM = '00000000-0000-4000-8000-000000000004';
const usman = { date_of_birth: '1988-03-14', sex_at_birth: 'male' as const };
const maryam = { date_of_birth: '2022-01-10', sex_at_birth: 'female' as const };
const T2 = CONDITION_OPTIONS.find((c) => c.key === 'type_2_diabetes')!.snomed;

const answersOf = (id: string) => useIntakeDraftStore.getState().members[id]?.answers ?? {};

/** Walks a member through every visible step the way `useMemberStep.next` does. */
function walk(id: string, profile: IntakeMemberProfile): MemberIntakeStep[] {
  const seen: MemberIntakeStep[] = [];
  let step: MemberIntakeStep | null = visibleSteps(
    intakeContext(profile, answersOf(id), TODAY),
  )[0]!;
  while (step) {
    seen.push(step);
    useIntakeDraftStore.getState().completeStep(id, step);
    const answers = answersOf(id);
    step = nextIntakeStep(intakeContext(profile, answers, TODAY), answers, step);
  }
  return seen;
}

beforeEach(() => {
  useIntakeDraftStore.getState().reset();
  useIntakeDraftStore.getState().begin(HH);
});

describe('intake engine with the draft store', () => {
  it('walks an adult with no modules through the core steps and reaches a complete profile', () => {
    const store = useIntakeDraftStore.getState();
    store.updateAnswers(USMAN, {
      conditions: { none: true, items: [] },
      medications: { none: true, items: [] },
      supplements: { none: true, items: [] },
      allergies: { none: true, items: [] },
      likes: [{ id: 'l1', label: 'Daal', strength: 2 }],
      dislikes: [],
      lifestyle: {
        meal_pattern: [{ meal: 'breakfast' }, { meal: 'lunch' }, { meal: 'dinner' }],
        water_glasses_per_day: 6,
        caffeine: { cups_per_day: 3 },
        exercise_minutes_per_week: 90,
      },
      modules: [],
      goals: [{ id: 'g1', goal_type: 'weight_loss', is_primary: true }],
      screening: {
        intends_to_fast: false,
        unintended_weight_change: null,
        eating_disorder_history: 'no',
      },
    });
    const steps = walk(USMAN, usman);
    expect(steps).toEqual(['health', 'allergies', 'food', 'lifestyle', 'modules', 'goals']);
    const ctx = intakeContext(usman, answersOf(USMAN), TODAY);
    const c = completeness(ctx, answersOf(USMAN));
    expect(c.requiredMissing).toEqual([]);
    expect(c.complete).toBe(true);
    expect(useIntakeDraftStore.getState().members[USMAN]?.completed).toEqual(steps);
  });

  it('adds the sensory and picky module steps for an autistic four-year-old', () => {
    useIntakeDraftStore.getState().updateAnswers(MARYAM, { modules: ['autism'] });
    const steps = walk(MARYAM, maryam);
    expect(steps).toContain('sensory');
    expect(steps).toContain('picky');
    expect(steps).not.toContain('pregnancy');
    expect(steps.indexOf('sensory')).toBeGreaterThan(steps.indexOf('modules'));
    expect(memberStepTarget('sensory', MARYAM, ['autism'])).toEqual({
      name: 'IntakeModuleSensory',
      params: { familyMemberId: MARYAM },
    });
  });

  it('resumes at the saved position with the answers intact', () => {
    const store = useIntakeDraftStore.getState();
    store.updateAnswers(USMAN, { conditions: { none: true, items: [] } });
    store.completeStep(USMAN, 'health');
    store.setView('member', { memberId: USMAN, step: 'allergies' });
    const persisted = useIntakeDraftStore.persist.getOptions().partialize!(
      useIntakeDraftStore.getState(),
    );
    const restored = migrateIntakeDraft(JSON.parse(JSON.stringify(persisted)));
    expect(restored.position).toEqual({ memberId: USMAN, step: 'allergies' });
    expect(restored.members[USMAN]?.answers.conditions).toEqual({ none: true, items: [] });
    expect(restored.members[USMAN]?.completed).toEqual(['health']);
  });

  it('marks an assessment stale when any answer changes', () => {
    const store = useIntakeDraftStore.getState();
    store.setAssessment({
      household_id: HH,
      assessments: [],
      disclaimer_key: 'disclaimer.not_medical_advice',
    });
    expect(useIntakeDraftStore.getState().assessment).not.toBeNull();
    store.updateAnswers(USMAN, { modules: [] });
    expect(useIntakeDraftStore.getState().assessment).toBeNull();
  });

  it('turns insulin plus intent to fast into a red flag and screening payload', () => {
    useIntakeDraftStore.getState().updateAnswers(USMAN, {
      conditions: { none: false, items: [{ id: 'c1', condition_code: T2, label: 'Type 2' }] },
      medications: {
        none: false,
        items: [{ id: 'm1', name: 'Insulin glargine', food_interaction_flags: ['insulin'] }],
      },
      screening: { intends_to_fast: true },
    });
    const answers = answersOf(USMAN);
    expect(intakeRedFlags(intakeContext(usman, answers, TODAY), answers)).toContain(
      'insulin_or_sulfonylurea_fasting',
    );
    // The server reads insulin from the saved condition row; the screening carries the intent.
    expect(screeningFor(answers)).toMatchObject({
      intends_to_fast: true,
      gags_on_most_textures: false,
    });
  });

  it('averages member scores for the household and counts skipped members at zero', () => {
    expect(householdCompleteness([100, 50, 0])).toBe(50);
    expect(householdCompleteness([])).toBe(0);
  });
});

describe('migrateIntakeDraft', () => {
  const NOW = Date.parse('2026-10-06T00:00:00Z');

  it('keeps a current draft and drops other versions or stale drafts', () => {
    const current = {
      ...initialIntakeDraft,
      householdId: HH,
      schemaVersion: INTAKE_SCHEMA_VERSION,
      updatedAt: NOW - 1000,
    };
    expect(migrateIntakeDraft(current, NOW).householdId).toBe(HH);
    expect(migrateIntakeDraft({ ...current, schemaVersion: 0 }, NOW)).toEqual(initialIntakeDraft);
    expect(migrateIntakeDraft({ ...current, updatedAt: NOW - DRAFT_MAX_AGE_MS - 1 }, NOW)).toEqual(
      initialIntakeDraft,
    );
    expect(migrateIntakeDraft(undefined, NOW)).toEqual(initialIntakeDraft);
  });
});
