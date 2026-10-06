import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';

import {
  REPORT_REASONS,
  reportTargetColumns,
  submitSourceReport,
  type ReportReason,
} from '../api/source-reports-api';

/**
 * Report a source (S6-14, 13 §8): wrong citation, translation, grade or tradition label, or
 * something offensive. The content team reviews every report; the reporter sees "thank you".
 */
export function ReportSourceSheet({ route, navigation }: RootScreenProps<'ReportSourceSheet'>) {
  const target = route.params;
  const { t } = useTranslation(['knowledge', 'errors']);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const cols = reportTargetColumns(target);
  const submit = useMutation({
    mutationKey: ['source-reports', 'submit'],
    mutationFn: () => submitSourceReport(target, reason as ReportReason, note.trim() || null),
    onSuccess: () => {
      if (cols && reason) track('source_reported', { reason, target: cols.kind });
    },
  });
  const already = isAppError(submit.error) && submit.error.code === 'CONFLICT';

  if (submit.isSuccess || already)
    return (
      <Screen testID="report-source.screen">
        <Text variant="title" accessibilityRole="header">
          {t('knowledge:report.thanksTitle')}
        </Text>
        <Text testID={already ? 'report-source.already' : 'report-source.thanks'}>
          {already ? t('knowledge:report.already') : t('knowledge:report.thanksBody')}
        </Text>
        <Button
          label={t('knowledge:close')}
          onPress={() => navigation.goBack()}
          testID="report-source.close"
        />
      </Screen>
    );

  return (
    <Screen testID="report-source.screen">
      <Text variant="title" accessibilityRole="header">
        {t('knowledge:report.title')}
      </Text>
      <Text tone="muted">{t('knowledge:report.intro')}</Text>
      <ChipGroup
        label={t('knowledge:report.reason')}
        single
        options={REPORT_REASONS.map((r) => ({
          value: r,
          label: t(`knowledge:report.reasons.${r}`),
        }))}
        selected={reason ? [reason] : []}
        onToggle={setReason}
        testID="report-source.reason"
      />
      <Input
        label={t('knowledge:report.note')}
        helperText={t('knowledge:report.noteHint')}
        value={note}
        onChangeText={setNote}
        variant="multiline"
        maxLength={1000}
        testID="report-source.note"
      />
      {submit.error && !already ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(submit.error)}`)} />
      ) : null}
      <Button
        label={t('knowledge:report.submit')}
        onPress={() => submit.mutate()}
        disabled={!reason || !cols}
        loading={submit.isPending}
        fullWidth
        testID="report-source.submit"
      />
    </Screen>
  );
}
