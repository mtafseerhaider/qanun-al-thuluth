import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { z } from 'zod';

import type { AiIntakeAssessResponse } from '@shared/contracts';
import type { HouseholdPreferences } from '@shared/domain/intake';
import {
  INTAKE_SCHEMA_VERSION,
  type MemberIntakeAnswers,
  type MemberIntakeStep,
} from '@shared/intake/questions';

import { draftsJsonStorage } from '@/lib/storage/drafts-storage';
import { resetters } from '@/stores/create-store';

/**
 * Intake drafts (09 §5.4, 08 §7.3) for onboarding step 5. Answers per family member are kept on the
 * encrypted drafts MMKV instance so an app kill loses nothing (FR-ONB-01); each step is also
 * written to the server on Next, so the draft is a resume aid, not the source of truth.
 */
export type IntakeView = 'household' | 'members' | 'member' | 'review';

export interface MemberDraft {
  answers: MemberIntakeAnswers;
  completed: MemberIntakeStep[];
  /** "Finish later": the member is assessed with life-stage defaults (02 §5.3). */
  skipped: boolean;
  updatedAt: number;
}

export type PreferencesDraft = z.input<typeof HouseholdPreferences>;

export interface IntakeDraftState {
  householdId: string | null;
  preferences: PreferencesDraft | null;
  preferencesSaved: boolean;
  members: Record<string, MemberDraft>;
  view: IntakeView;
  position: { memberId: string; step: MemberIntakeStep } | null;
  /** Last successful `ai-intake-assess` response, so a resumed app shows it without a new call. */
  assessment: AiIntakeAssessResponse | null;
  schemaVersion: number;
  updatedAt: number;
}

export interface IntakeDraftActions {
  begin(householdId: string, now?: number): void;
  setPreferences(p: PreferencesDraft): void;
  markPreferencesSaved(): void;
  updateAnswers(
    memberId: string,
    patch: Partial<MemberIntakeAnswers> | ((prev: MemberIntakeAnswers) => MemberIntakeAnswers),
  ): void;
  completeStep(memberId: string, step: MemberIntakeStep): void;
  setSkipped(memberId: string, skipped: boolean): void;
  setView(view: IntakeView, position?: { memberId: string; step: MemberIntakeStep } | null): void;
  setAssessment(a: AiIntakeAssessResponse | null): void;
  reset(): void;
}

export const DRAFT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export const initialIntakeDraft: IntakeDraftState = {
  householdId: null,
  preferences: null,
  preferencesSaved: false,
  members: {},
  view: 'household',
  position: null,
  assessment: null,
  schemaVersion: INTAKE_SCHEMA_VERSION,
  updatedAt: 0,
};

const emptyMember = (): MemberDraft => ({
  answers: {},
  completed: [],
  skipped: false,
  updatedAt: Date.now(),
});

/** Pure migration (09 §6.3): a draft from another schema version or older than 30 days is dropped. */
export function migrateIntakeDraft(persisted: unknown, now = Date.now()): IntakeDraftState {
  const p = persisted as Partial<IntakeDraftState> | undefined;
  if (!p || p.schemaVersion !== INTAKE_SCHEMA_VERSION) return initialIntakeDraft;
  if (typeof p.updatedAt === 'number' && now - p.updatedAt > DRAFT_MAX_AGE_MS)
    return initialIntakeDraft;
  return { ...initialIntakeDraft, ...p };
}

export const useIntakeDraftStore = create<IntakeDraftState & IntakeDraftActions>()(
  devtools(
    persist(
      (set, get) => {
        const touch = () => ({ updatedAt: Date.now() });
        const member = (id: string) => get().members[id] ?? emptyMember();
        return {
          ...initialIntakeDraft,
          begin: (householdId, now = Date.now()) => {
            if (get().householdId === householdId) return;
            set({ ...initialIntakeDraft, householdId, updatedAt: now });
          },
          setPreferences: (preferences) =>
            set({ preferences, preferencesSaved: false, ...touch() }),
          markPreferencesSaved: () => set({ preferencesSaved: true, ...touch() }),
          updateAnswers: (memberId, patch) => {
            const m = member(memberId);
            const answers =
              typeof patch === 'function' ? patch(m.answers) : { ...m.answers, ...patch };
            // Any change after an assessment makes it stale.
            set({
              members: { ...get().members, [memberId]: { ...m, answers, updatedAt: Date.now() } },
              assessment: null,
              ...touch(),
            });
          },
          completeStep: (memberId, step) => {
            const m = member(memberId);
            if (m.completed.includes(step) && !m.skipped) return;
            set({
              members: {
                ...get().members,
                [memberId]: {
                  ...m,
                  skipped: false,
                  completed: m.completed.includes(step) ? m.completed : [...m.completed, step],
                  updatedAt: Date.now(),
                },
              },
              ...touch(),
            });
          },
          setSkipped: (memberId, skipped) => {
            const m = member(memberId);
            set({ members: { ...get().members, [memberId]: { ...m, skipped } }, ...touch() });
          },
          setView: (view, position) =>
            set({ view, ...(position !== undefined ? { position } : {}), ...touch() }),
          setAssessment: (assessment) => set({ assessment, ...touch() }),
          reset: () => set(initialIntakeDraft),
        };
      },
      {
        name: 'store.intake-drafts',
        version: 1,
        storage: draftsJsonStorage,
        migrate: (p) => migrateIntakeDraft(p),
        merge: (persisted, current) => ({ ...current, ...migrateIntakeDraft(persisted) }),
        partialize: ({
          householdId,
          preferences,
          preferencesSaved,
          members,
          view,
          position,
          assessment,
          schemaVersion,
          updatedAt,
        }) => ({
          householdId,
          preferences,
          preferencesSaved,
          members,
          view,
          position,
          assessment,
          schemaVersion,
          updatedAt,
        }),
      },
    ),
    { name: 'intake-drafts', enabled: __DEV__ },
  ),
);

resetters.add(() => useIntakeDraftStore.getState().reset());

export function selectMemberDraft(memberId: string) {
  return (s: IntakeDraftState): MemberDraft | undefined => s.members[memberId];
}
