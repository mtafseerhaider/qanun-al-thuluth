import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { AccountDeleteReason } from '@shared/contracts';

import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';

import { DeletionCountdownCard } from '../components/deletion-countdown-card';
import { ReauthPanel } from '../components/reauth-panel';
import { useAccountDeletion, useAccountState } from '../hooks/use-privacy';
import {
  GRACE_DAYS,
  deleteProblem,
  deletionState,
  householdsToTransfer,
} from '../utils/privacy-rules';

const REASONS = ['privacy', 'not_useful', 'too_expensive', 'other'] as const;
const WHAT_GOES = ['profile', 'family', 'health', 'logs', 'chat'] as const;

/**
 * Delete account (02 §7.13.6, 16 §7.5, FR-SET-05). Three taps from More: More, Privacy, Delete
 * account. A fresh email code confirms it (11 §15.1); deletion runs after 30 days and can be
 * cancelled until then. The user stays signed in during the grace period and sees the countdown.
 */
export function DeleteAccountScreen({ navigation }: MoreScreenProps<'DeleteAccount'>) {
  const { t } = useTranslation('privacy');
  const account = useAccountState();
  const { request, cancel } = useAccountDeletion();
  const [reason, setReason] = useState<AccountDeleteReason | null>(null);
  const [reauthAgain, setReauthAgain] = useState(false);
  const state = deletionState(account.data?.deletionScheduledFor ?? null, Date.now());
  const problem = request.error ? deleteProblem(request.error) : null;

  const submit = () => {
    setReauthAgain(false);
    request.mutate(reason, {
      onError: (e) => {
        if (deleteProblem(e) === 'reauth') setReauthAgain(true);
      },
    });
  };

  if (state.pending)
    return (
      <Screen testID="delete-account.screen">
        <Text variant="title" accessibilityRole="header">
          {t('delete.title')}
        </Text>
        <DeletionCountdownCard
          state={state}
          onCancel={() => cancel.mutate(undefined, { onSuccess: () => navigation.goBack() })}
          cancelling={cancel.isPending}
          error={cancel.error}
        />
        {request.data?.action === 'request' && request.data.active_subscription_warning ? (
          <InlineMessage
            tone="warning"
            message={t('delete.subscriptionWarning')}
            testID="delete-account.subscription"
          />
        ) : null}
      </Screen>
    );

  return (
    <Screen testID="delete-account.screen">
      <Text variant="title" accessibilityRole="header">
        {t('delete.title')}
      </Text>
      <Text>{t('delete.intro', { days: GRACE_DAYS })}</Text>
      <View className="gap-1">
        <Text variant="bodyStrong">{t('delete.whatGoesTitle')}</Text>
        {WHAT_GOES.map((k) => (
          <Text key={k}>{t('delete.bullet', { text: t(`delete.whatGoes.${k}`) })}</Text>
        ))}
      </View>
      <Text tone="muted">{t('delete.households')}</Text>
      <Text tone="muted">{t('delete.subscriptions')}</Text>
      <ChipGroup
        label={t('delete.reason')}
        hint={t('delete.reasonHint')}
        single
        options={REASONS.map((r) => ({ value: r, label: t(`delete.reasons.${r}`) }))}
        selected={reason ? [reason] : []}
        onToggle={(r) => setReason((cur) => (cur === r ? null : r))}
        testID="delete-account.reason"
      />
      {problem === 'transfer_ownership' ? (
        <InlineMessage
          tone="warning"
          title={t('delete.transferTitle')}
          message={t('delete.transferBody', {
            households:
              householdsToTransfer(request.error).join(', ') || t('delete.yourHouseholds'),
          })}
          testID="delete-account.transfer"
        />
      ) : problem === 'already_pending' ? (
        <InlineMessage tone="info" message={t(`errors:${errorKeyFor(request.error)}`)} />
      ) : reauthAgain ? (
        <InlineMessage
          tone="info"
          message={t('delete.reauthAgain')}
          testID="delete-account.reauth-again"
        />
      ) : request.error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(request.error)}`)} />
      ) : null}
      <ReauthPanel
        key={reauthAgain ? 'again' : 'first'}
        actionLabel={t('delete.confirm')}
        destructive
        onVerified={submit}
        busy={request.isPending}
        testID="delete-account.reauth"
      />
    </Screen>
  );
}
