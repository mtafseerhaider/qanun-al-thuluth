import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { RedFlagScreening } from '@shared/domain/intake';
import { screeningFor } from '@shared/intake/questions';

import { track } from '@/lib/analytics/track';

import { runIntakeAssessment } from '../api/intake-api';
import { useIntakeDraftStore } from '../store/use-intake-draft-store';

/**
 * Runs `ai-intake-assess` for the household (06 §4.2) with each member's red-flag screening answers
 * (they are not stored as rows), and keeps the response in the encrypted draft so a resumed app
 * shows it without a new call.
 */
export function useRunIntakeAssessment(householdId: string | null) {
  const { i18n } = useTranslation();
  return useMutation({
    mutationKey: ['intake', 'assess'],
    mutationFn: async () => {
      if (!householdId) throw new Error('No household');
      const members = useIntakeDraftStore.getState().members;
      const screening: Record<string, RedFlagScreening> = {};
      for (const [id, draft] of Object.entries(members))
        screening[id] = screeningFor(draft.answers);
      track('ai_assessment_requested', {});
      return runIntakeAssessment({
        householdId,
        locale: i18n.language === 'ur' ? 'ur' : 'en',
        screening,
      });
    },
    onSuccess: (response) => useIntakeDraftStore.getState().setAssessment(response),
  });
}
