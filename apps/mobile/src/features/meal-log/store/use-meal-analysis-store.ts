import type { MealType } from '@shared';
import type { AiAnalyzeMealResponse } from '@shared/contracts';

import { createStore, resetters } from '@/stores/create-store';

/**
 * The analysis between capture (X3) and the result screen (X4). Memory only (09 §9: photos and
 * attachments in progress are transient); the meal log row is written only when the user saves.
 */
export interface MealAnalysisDraft {
  analysisId: string;
  mealLogId: string;
  householdId: string;
  memberId: string;
  minor: boolean;
  mealType: MealType;
  eatenAt: string;
  note: string;
  photoUri: string;
  photoPath: string;
  result: AiAnalyzeMealResponse;
  sessionId: string | null;
}

interface State {
  drafts: Record<string, MealAnalysisDraft>;
  put(d: MealAnalysisDraft): void;
  drop(analysisId: string): void;
  reset(): void;
}

export const useMealAnalysisStore = createStore<State>('meal-analysis', (set) => ({
  drafts: {},
  put: (d) => set((s) => ({ drafts: { ...s.drafts, [d.analysisId]: d } })),
  drop: (id) =>
    set((s) => ({
      drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== id)),
    })),
  reset: () => set({ drafts: {} }),
}));

resetters.add(() => useMealAnalysisStore.getState().reset());
