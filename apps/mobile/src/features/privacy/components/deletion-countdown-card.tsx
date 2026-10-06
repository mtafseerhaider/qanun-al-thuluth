import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { useAnnounceOnChange } from '@/hooks/use-announce';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { deleteProblem, type DeletionState } from '../utils/privacy-rules';

/** Grace-period banner with the cancel button (FR-SET-05): shown wherever deletion is pending. */
export function DeletionCountdownCard({
  state,
  onCancel,
  cancelling,
  error,
  testID = 'deletion-countdown',
}: {
  state: DeletionState;
  onCancel: () => void;
  cancelling: boolean;
  error: unknown;
  testID?: string;
}) {
  const { t } = useTranslation('privacy');
  // A11y audit gap 1 (24 S7-04): announce when deletion is scheduled, starts, or is cancelled.
  const phase = state.pending ? (state.inProgress ? 'in_progress' : 'scheduled') : 'none';
  useAnnounceOnChange(
    phase,
    phase === 'scheduled'
      ? t('countdown.title')
      : phase === 'in_progress'
        ? t('countdown.inProgressTitle')
        : t('countdown.cancelled'),
  );
  if (!state.pending) return null;
  const problem = error ? deleteProblem(error) : null;
  return (
    <Card variant="outlined" testID={testID}>
      <Text variant="heading" accessibilityRole="header">
        {state.inProgress ? t('countdown.inProgressTitle') : t('countdown.title')}
      </Text>
      <Text testID={`${testID}.days`}>
        {state.inProgress
          ? t('countdown.inProgressBody')
          : t('countdown.body', {
              count: state.daysLeft ?? 0,
              date: (state.scheduledFor ?? '').slice(0, 10),
            })}
      </Text>
      {problem === 'in_progress' ? (
        <InlineMessage tone="info" message={t('countdown.tooLate')} />
      ) : error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} />
      ) : null}
      {!state.inProgress ? (
        <Button
          label={t('countdown.cancel')}
          onPress={onCancel}
          loading={cancelling}
          testID={`${testID}.cancel`}
        />
      ) : null}
    </Card>
  );
}
