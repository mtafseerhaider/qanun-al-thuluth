import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { appJsonStorage } from '@/lib/storage/zustand-storage';
import { resetters } from '@/stores/create-store';

/**
 * Resumable onboarding (09 §5.3, FR-ONB-01). Sprint 1 covers steps 1 to 4 of 24 (welcome,
 * philosophy, household, members) with the consent step before any health data. The server flag
 * `users.onboarding_completed_at` is the source of truth for "done"; this store only resumes the flow
 * at the last incomplete step after the app is killed or reloaded for an RTL switch.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'philosophy',
  'consents',
  'household',
  'members',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | 'done';

export interface HouseholdDraft {
  /** Client id used for the insert, generated once so a retry after a crash is idempotent. */
  id: string;
  name: string;
  country_code: string;
  city: string;
  currency: string;
  timezone: string;
  budgetMajor: string;
}

export interface OnboardingState {
  /** The user this progress belongs to; a different user starts fresh. */
  userId: string | null;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  householdDraft: HouseholdDraft | null;
  /** Client id of the created household, so a crash after creation never creates a duplicate. */
  createdHouseholdId: string | null;
  /** True when the user joined a household by invitation and skips creating one (FR-AUTH-08). */
  joinedByInvite: boolean;
  startedAt: number | null;
}

export interface OnboardingActions {
  begin(userId: string, now?: number): void;
  goTo(step: OnboardingStep): void;
  complete(step: OnboardingStep): void;
  setHouseholdDraft(draft: HouseholdDraft | null): void;
  setCreatedHouseholdId(id: string): void;
  setJoinedByInvite(joined: boolean): void;
  reset(): void;
}

export const initialOnboarding: OnboardingState = {
  userId: null,
  currentStep: 'welcome',
  completedSteps: [],
  householdDraft: null,
  createdHouseholdId: null,
  joinedByInvite: false,
  startedAt: null,
};

/** The step after `step`; the household step is skipped for users who joined by invitation. */
export function nextStep(
  step: OnboardingStep,
  opts: { skipHousehold?: boolean } = {},
): OnboardingStep {
  if (step === 'done') return 'done';
  const i = ONBOARDING_STEPS.indexOf(step);
  const next = ONBOARDING_STEPS[i + 1] ?? 'done';
  if (next === 'household' && opts.skipHousehold) return nextStep('household', opts);
  return next;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  if (step === 'done') return 'members';
  const i = ONBOARDING_STEPS.indexOf(step);
  return i > 0 ? (ONBOARDING_STEPS[i - 1] ?? null) : null;
}

/** 1-based position for the progress bar. */
export function stepNumber(step: OnboardingStep): number {
  return step === 'done' ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(step) + 1;
}

export const ONBOARDING_STORE_VERSION = 1;

/** Pure migration (09 §6.3); v1 is the first shipped shape. Unknown steps resume at welcome. */
export function migrateOnboarding(persisted: unknown, _version: number): OnboardingState {
  const p = { ...initialOnboarding, ...(persisted as Partial<OnboardingState> | undefined) };
  const valid = (s: unknown): s is OnboardingStep =>
    s === 'done' || (ONBOARDING_STEPS as readonly unknown[]).includes(s);
  return {
    ...p,
    currentStep: valid(p.currentStep) ? p.currentStep : 'welcome',
    completedSteps: Array.isArray(p.completedSteps) ? p.completedSteps.filter(valid) : [],
  };
}

export const useOnboardingStore = create<OnboardingState & OnboardingActions>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialOnboarding,
        begin: (userId, now = Date.now()) => {
          if (get().userId === userId) return;
          set({ ...initialOnboarding, userId, startedAt: now });
        },
        goTo: (currentStep) => set({ currentStep }),
        complete: (step) =>
          set((s) => ({
            completedSteps: s.completedSteps.includes(step)
              ? s.completedSteps
              : [...s.completedSteps, step],
            currentStep: nextStep(step, { skipHousehold: s.joinedByInvite }),
          })),
        setHouseholdDraft: (householdDraft) => set({ householdDraft }),
        setCreatedHouseholdId: (createdHouseholdId) => set({ createdHouseholdId }),
        setJoinedByInvite: (joinedByInvite) => set({ joinedByInvite }),
        reset: () => set(initialOnboarding),
      }),
      {
        name: 'store.onboarding',
        version: ONBOARDING_STORE_VERSION,
        storage: appJsonStorage,
        migrate: migrateOnboarding,
        partialize: ({
          userId,
          currentStep,
          completedSteps,
          householdDraft,
          createdHouseholdId,
          joinedByInvite,
          startedAt,
        }) => ({
          userId,
          currentStep,
          completedSteps,
          householdDraft,
          createdHouseholdId,
          joinedByInvite,
          startedAt,
        }),
      },
    ),
    { name: 'onboarding', enabled: __DEV__ },
  ),
);

resetters.add(() => useOnboardingStore.getState().reset());
