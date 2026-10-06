import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { isPurchasesAvailable } from '@/lib/purchases/purchases';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';

import { DowngradeBanner } from '../components/upsell-card';
import {
  useEntitlements,
  usePaywall,
  usePremium,
  useRestorePurchases,
} from '../hooks/use-subscription';
import { BENEFITS, downgradeNotice, statusKey } from '../utils/paywall-rules';

const MANAGE_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
});

/**
 * S2 Subscription (02 §7.13.3, 17 §10 to §12): tier and status in plain words, renewal date, manage
 * in the store, restore, what's included, household-shared premium, and downgrade notices. Data is
 * never deleted on downgrade (FR-SUB-06).
 */
export function SubscriptionScreen(_props: MoreScreenProps<'Subscription'>) {
  const { t, i18n } = useTranslation(['subscription', 'errors']);
  const online = useIsOnline();
  const ent = useEntitlements();
  const { premium } = usePremium();
  const openPaywall = usePaywall();
  const restore = useRestorePurchases();
  const e = ent.data ?? null;
  const date = e?.currentPeriodEnd
    ? new Date(e.currentPeriodEnd).toLocaleDateString(i18n.language, { dateStyle: 'medium' })
    : null;
  const sharedOnly = Boolean(e && e.householdPremium && !e.personalPremium);

  return (
    <Screen testID="subscription.screen" refreshing={ent.isRefetching} onRefresh={ent.refetch}>
      <Card variant="elevated" testID="subscription.tier">
        <Text variant="overline" tone="muted">
          {t('subscription:tier.label')}
        </Text>
        <Text variant="heading" testID="subscription.tier.value">
          {premium ? t('subscription:tier.premium') : t('subscription:tier.free')}
        </Text>
        <Text tone="muted" testID="subscription.status">
          {t(`subscription:${statusKey(e?.status ?? null, premium)}`, { date: date ?? '' })}
        </Text>
        {e?.trial ? <Text tone="muted">{t('subscription:trialActive')}</Text> : null}
        {date && e?.personalPremium ? (
          <Text variant="caption" tone="muted">
            {e.willRenew ? t('subscription:renews', { date }) : t('subscription:endsOn', { date })}
          </Text>
        ) : null}
        {sharedOnly ? (
          <Text variant="caption" tone="muted" testID="subscription.shared">
            {t('subscription:sharedByHousehold')}
          </Text>
        ) : null}
      </Card>

      <DowngradeBanner notice={downgradeNotice(e)} />

      {ent.isError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(ent.error)}`)} />
      ) : null}

      {!premium ? (
        <Button
          label={t('subscription:seePremium')}
          onPress={() => openPaywall('settings')}
          testID="subscription.upgrade"
        />
      ) : null}
      {e?.personalPremium ? (
        <Button
          label={
            Platform.OS === 'ios' ? t('subscription:manageIos') : t('subscription:manageAndroid')
          }
          variant="secondary"
          onPress={() => void Linking.openURL(MANAGE_URL)}
          testID="subscription.manage"
        />
      ) : null}
      <Button
        label={t('subscription:restore')}
        variant="ghost"
        loading={restore.isPending}
        disabled={!online || !isPurchasesAvailable()}
        onPress={() => restore.mutate()}
        testID="subscription.restore"
      />
      {restore.data ? (
        <InlineMessage
          tone={restore.data.active ? 'success' : 'info'}
          message={
            restore.data.active
              ? t('subscription:messages.restored')
              : t('subscription:messages.nothingToRestore')
          }
        />
      ) : null}

      <Card variant="filled">
        <Text variant="bodyStrong">{t('subscription:included')}</Text>
        {BENEFITS.map((b) => (
          <Text key={b}>
            {t('subscription:paywall.benefitLine', { benefit: t(`subscription:benefits.${b}`) })}
          </Text>
        ))}
        <Text variant="caption" tone="muted">
          {t('subscription:fine.safety')}
        </Text>
      </Card>
    </Screen>
  );
}
