import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EXPORT_PDF_MVP_KINDS, type ExportPdfMvpKind } from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { UpsellCard, usePremium } from '@/features/subscription';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useExports, useShareExport } from '../hooks/use-exports';
import { displayStatus, exportProblem } from '../utils/export-rules';

/**
 * Exports (02 §7.13.8, FR-EXP-01 to -04): past PDFs for the household and a button for a new one.
 * A ready export can be shared again with a freshly signed link until the file expires.
 */
export function ExportsScreen({ navigation }: MoreScreenProps<'Exports'>) {
  const { t } = useTranslation('exports');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const { premium } = usePremium(householdId);
  const list = useExports(householdId);
  const share = useShareExport();
  const now = Date.now();
  const problem = share.error ? exportProblem(share.error) : null;

  return (
    <Screen
      testID="exports.screen"
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
    >
      <Text variant="title" accessibilityRole="header">
        {t('title')}
      </Text>
      <Text tone="muted">{t('intro')}</Text>
      {premium ? (
        <Button
          label={t('new')}
          onPress={() => navigation.navigate('CreateExportSheet', {})}
          fullWidth
          testID="exports.new"
        />
      ) : (
        <UpsellCard
          trigger="export"
          title={t('upsellTitle')}
          body={t('upsellBody')}
          testID="exports.upsell"
        />
      )}
      {problem === 'not_available' ? (
        <InlineMessage tone="info" title={t('notAvailableTitle')} message={t('notAvailableBody')} />
      ) : share.error ? (
        <InlineMessage
          tone="danger"
          message={
            problem && problem !== 'generic'
              ? t(`problems.${problem}`)
              : t(`errors:${errorKeyFor(share.error)}`)
          }
        />
      ) : null}
      {(list.data ?? []).length === 0 && !list.isLoading ? (
        <Text tone="muted" testID="exports.empty">
          {t('empty')}
        </Text>
      ) : null}
      {(list.data ?? []).map((row) => {
        const status = displayStatus(row.status, row.expiresAt, now);
        const kind = (EXPORT_PDF_MVP_KINDS as readonly string[]).includes(row.kind)
          ? (row.kind as ExportPdfMvpKind)
          : null;
        return (
          <Card key={row.id} variant="outlined" testID="exports.item">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <View className="flex-1">
                <Text variant="bodyStrong">{kind ? t(`kinds.${kind}`) : row.kind}</Text>
                <Text variant="caption" tone="muted">
                  {t('row', { date: row.createdAt.slice(0, 10), status: t(`status.${status}`) })}
                </Text>
              </View>
              {status === 'ready' && kind ? (
                <Button
                  label={t('shareAgain')}
                  size="sm"
                  variant="secondary"
                  loading={share.isPending && share.variables?.exportId === row.id}
                  onPress={() =>
                    share.mutate({
                      exportId: row.id,
                      kind,
                      date: row.createdAt.slice(0, 10),
                      dialogTitle: t('shareTitle'),
                    })
                  }
                  testID="exports.share"
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
