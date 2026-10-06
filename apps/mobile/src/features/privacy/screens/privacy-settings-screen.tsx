import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { DeletionCountdownCard } from '../components/deletion-countdown-card';
import { ReauthPanel } from '../components/reauth-panel';
import {
  useAccountDeletion,
  useAccountExport,
  useAccountState,
  useConsentRows,
  useSetAnalyticsOptOut,
  useWithdrawConsent,
} from '../hooks/use-privacy';
import type { ConsentRow } from '../api/privacy-api';
import { deletionState, isWithdrawable, needsReauth } from '../utils/privacy-rules';

/**
 * Privacy and data (02 §7.13.4, FR-SET-05 to -07). Withdraw consents (with what changes), the
 * analytics opt-out, download my data (fresh sign-in, 24 h link by email) and the delete-account
 * entry, with the grace countdown and Cancel when deletion is pending.
 */
export function PrivacySettingsScreen({ navigation }: MoreScreenProps<'SettingsPrivacy'>) {
  const { t } = useTranslation('privacy');
  const account = useAccountState();
  const optOut = usePreferencesStore((s) => s.analyticsOptOut);
  const setOptOut = useSetAnalyticsOptOut();
  const consents = useConsentRows();
  const withdraw = useWithdrawConsent();
  const exportData = useAccountExport();
  const { cancel } = useAccountDeletion();
  const [showExportReauth, setShowExportReauth] = useState(false);
  const state = deletionState(account.data?.deletionScheduledFor ?? null, Date.now());

  const confirmWithdraw = (row: ConsentRow) => {
    if (!isWithdrawable(row.kind)) return;
    Alert.alert(t(`consents.kinds.${row.kind}`), t(`consents.effects.${row.kind}`), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('consents.withdraw'), style: 'destructive', onPress: () => withdraw.mutate(row) },
    ]);
  };
  const startExport = () =>
    exportData.mutate(undefined, {
      onError: (e) => {
        if (needsReauth(e)) setShowExportReauth(true);
      },
    });

  return (
    <Screen testID="privacy.screen">
      <Text variant="title" accessibilityRole="header">
        {t('title')}
      </Text>
      <DeletionCountdownCard
        state={state}
        onCancel={() => cancel.mutate()}
        cancelling={cancel.isPending}
        error={cancel.error}
        testID="privacy.countdown"
      />

      <Card variant="outlined" testID="privacy.analytics">
        <Text variant="heading" accessibilityRole="header">
          {t('analytics.title')}
        </Text>
        <Text tone="muted">{t('analytics.body')}</Text>
        <Checkbox
          label={t('analytics.optOut')}
          checked={optOut}
          onChange={(v) => setOptOut.mutate(v)}
          testID="privacy.analytics.opt-out"
        />
        {setOptOut.error ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(setOptOut.error)}`)} />
        ) : null}
      </Card>

      <Card variant="outlined" testID="privacy.consents">
        <Text variant="heading" accessibilityRole="header">
          {t('consents.title')}
        </Text>
        <Text tone="muted">{t('consents.body')}</Text>
        {(consents.data ?? []).map((row) => (
          <View
            key={row.id}
            className="min-h-control flex-row flex-wrap items-center justify-between gap-2 border-b border-line py-2"
          >
            <View className="flex-1">
              <Text>{t(`consents.kinds.${row.kind}`, { defaultValue: row.kind })}</Text>
              <Text variant="caption" tone="muted">
                {t('consents.since', { date: row.grantedAt.slice(0, 10) })}
              </Text>
            </View>
            {isWithdrawable(row.kind) ? (
              <Button
                label={t('consents.withdraw')}
                size="sm"
                variant="ghost"
                accessibilityLabel={t('consents.withdrawA11y', {
                  kind: t(`consents.kinds.${row.kind}`),
                })}
                onPress={() => confirmWithdraw(row)}
                testID={`privacy.consent.${row.kind}.withdraw`}
              />
            ) : (
              <Text variant="caption" tone="muted">
                {t('consents.required')}
              </Text>
            )}
          </View>
        ))}
        {withdraw.error ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(withdraw.error)}`)} />
        ) : null}
      </Card>

      <Card variant="outlined" testID="privacy.export">
        <Text variant="heading" accessibilityRole="header">
          {t('export.title')}
        </Text>
        <Text tone="muted">{t('export.body')}</Text>
        {exportData.isSuccess ? (
          <InlineMessage tone="success" message={t('export.sent')} testID="privacy.export.sent" />
        ) : showExportReauth ? (
          <ReauthPanel
            actionLabel={t('export.confirm')}
            onVerified={() => {
              setShowExportReauth(false);
              startExport();
            }}
            busy={exportData.isPending}
            testID="privacy.export.reauth"
          />
        ) : (
          <Button
            label={t('export.start')}
            variant="secondary"
            onPress={startExport}
            loading={exportData.isPending}
            testID="privacy.export.start"
          />
        )}
        {exportData.error && !needsReauth(exportData.error) ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(exportData.error)}`)} />
        ) : null}
      </Card>

      {!state.pending ? (
        <Card variant="outlined" testID="privacy.delete">
          <Text variant="heading" accessibilityRole="header">
            {t('deleteCard.title')}
          </Text>
          <Text tone="muted">{t('deleteCard.body')}</Text>
          <Button
            label={t('deleteCard.open')}
            variant="destructive"
            onPress={() => navigation.navigate('DeleteAccount')}
            testID="privacy.delete.open"
          />
        </Card>
      ) : null}
    </Screen>
  );
}
