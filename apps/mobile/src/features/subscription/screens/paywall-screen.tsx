import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import { isPurchasesAvailable, type StorePackage } from '@/lib/purchases/purchases';
import type { RootScreenProps } from '@/navigation/types';
import { useSubscriptionStore } from '@/stores/use-subscription-store';
import { cn } from '@/theme/cn';

import {
  useOffering,
  usePremium,
  usePurchase,
  useRestorePurchases,
} from '../hooks/use-subscription';
import {
  annualSavingPercent,
  benefitsFor,
  COMPARISON_ROWS,
  headlineKey,
  paywallPackages,
  perMonth,
} from '../utils/paywall-rules';

const TERMS_URL = 'https://thuluth.app/terms';
const PRIVACY_URL = 'https://thuluth.app/privacy';

/**
 * X1 Paywall (02 §7.13.3, §5.11, 17 §5, FR-SUB-01, -03, -04): contextual headline, benefits, the
 * free vs premium comparison table, store-priced plans (annual preselected), restore, terms and the
 * reassurance that safety stays free. Close is visible at once. After a purchase the interrupted
 * action resumes. Without a RevenueCat key the store section says it is unavailable.
 */
export function PaywallScreen({ route, navigation }: RootScreenProps<'PaywallModal'>) {
  const { trigger } = route.params;
  const { t, i18n } = useTranslation('subscription');
  const online = useIsOnline();
  const { premium } = usePremium();
  const offering = useOffering();
  const buy = usePurchase(trigger);
  const restore = useRestorePurchases();
  const resume = useSubscriptionStore((s) => s.resumePendingIntent);
  const clearIntent = useSubscriptionStore((s) => s.setPendingIntent);
  const openedAt = useRef(Date.now());
  const { annual, monthly } = paywallPackages(offering.data ?? null);
  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  const [message, setMessage] = useState<
    'pending' | 'restored' | 'nothingToRestore' | 'failed' | 'welcome' | null
  >(null);
  const saving = annualSavingPercent(annual, monthly);
  const chosen: StorePackage | null =
    selected === 'annual' ? (annual ?? monthly) : (monthly ?? annual);
  const storeAvailable = isPurchasesAvailable();

  useEffect(() => {
    track('paywall_shown', { trigger, has_offering: Boolean(offering.data) });
    // Once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Already premium (or premium just landed): close and resume what the user was doing.
  useEffect(() => {
    if (!premium) return;
    navigation.goBack();
    setTimeout(resume, 0);
  }, [premium, navigation, resume]);

  const close = () => {
    track('paywall_closed', {
      trigger,
      seconds_open: Math.min(86_400, Math.round((Date.now() - openedAt.current) / 1000)),
    });
    clearIntent(null);
    navigation.goBack();
  };

  const onBuy = () => {
    if (!chosen) return;
    buy.mutate(chosen, {
      onSuccess: (o) => {
        if (o.kind === 'pending') setMessage('pending');
        else if (o.kind === 'failed') setMessage('failed');
        else if (o.kind === 'purchased') setMessage(o.active ? 'welcome' : 'pending');
      },
      onError: () => setMessage('failed'),
    });
  };

  const onRestore = () =>
    restore.mutate(undefined, {
      onSuccess: (r) => setMessage(r.active ? 'restored' : 'nothingToRestore'),
      onError: () => setMessage('failed'),
    });

  const planCard = (pkg: StorePackage, period: 'annual' | 'monthly') => {
    const isSelected = selected === period;
    const label =
      period === 'annual'
        ? t('plans.annualA11y', { price: pkg.priceString, perMonth: perMonth(pkg, i18n.language) })
        : t('plans.monthlyA11y', { price: pkg.priceString });
    return (
      <Pressable
        key={period}
        accessibilityRole="radio"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={label}
        onPress={() => {
          setSelected(period);
          track('paywall_plan_selected', { period });
        }}
        className={cn(
          'gap-1 rounded-lg border p-4',
          isSelected ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface-raised',
        )}
        testID={`paywall.plan.${period}`}
      >
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="bodyStrong">{t(`plans.${period}`)}</Text>
          {period === 'annual' && saving !== null ? (
            <Text variant="caption" tone="primary" testID="paywall.saving">
              {t('plans.saving', { percent: saving })}
            </Text>
          ) : null}
        </View>
        <Text>{pkg.priceString}</Text>
        {period === 'annual' ? (
          <Text variant="caption" tone="muted">
            {t('plans.perMonth', { price: perMonth(pkg, i18n.language) })}
          </Text>
        ) : null}
        {pkg.trial ? (
          <Text variant="caption" tone="muted" testID={`paywall.plan.${period}.trial`}>
            {t('plans.trial', { count: pkg.trial.days })}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Screen edges={['top', 'bottom']} testID="paywall.screen">
      <View className="flex-row">
        <Button
          label={t('close')}
          variant="ghost"
          size="sm"
          accessibilityLabel={t('closeA11y')}
          onPress={close}
          disabled={buy.isPending}
          testID="paywall.close"
        />
      </View>

      <View className="gap-2">
        <Text variant="title" accessibilityRole="header" testID="paywall.headline">
          {t(headlineKey(trigger))}
        </Text>
        <Text tone="muted">{t('paywall.familyShared')}</Text>
      </View>

      <View className="gap-2" testID="paywall.benefits">
        {benefitsFor(trigger).map((b) => (
          <Text key={b}>{t('paywall.benefitLine', { benefit: t(`benefits.${b}`) })}</Text>
        ))}
      </View>

      <Card variant="outlined" padding="sm" testID="paywall.compare">
        <View className="flex-row gap-2 border-b border-line pb-2">
          <Text variant="label" className="flex-1">
            {t('compare.feature')}
          </Text>
          <Text variant="label" className="w-24">
            {t('compare.free')}
          </Text>
          <Text variant="label" className="w-28">
            {t('compare.premium')}
          </Text>
        </View>
        {COMPARISON_ROWS.map((row) => (
          <View
            key={row}
            className="flex-row gap-2 border-b border-line py-2"
            accessible
            accessibilityLabel={t('compare.rowA11y', {
              feature: t(`compare.rows.${row}.label`),
              free: t(`compare.rows.${row}.free`),
              premium: t(`compare.rows.${row}.premium`),
            })}
            testID={`paywall.compare.${row}`}
          >
            <Text variant="caption" className="flex-1">
              {t(`compare.rows.${row}.label`)}
            </Text>
            <Text variant="caption" tone="muted" className="w-24">
              {t(`compare.rows.${row}.free`)}
            </Text>
            <Text variant="caption" className="w-28">
              {t(`compare.rows.${row}.premium`)}
            </Text>
          </View>
        ))}
      </Card>

      <View className="gap-3" accessibilityRole="radiogroup" testID="paywall.plans">
        {!storeAvailable ? (
          <InlineMessage
            tone="info"
            message={t('store.unavailable')}
            testID="paywall.unavailable"
          />
        ) : offering.isLoading ? (
          <Text tone="muted">{t('store.loading')}</Text>
        ) : offering.isError || (!annual && !monthly) ? (
          <View className="gap-2">
            <InlineMessage tone="danger" message={t('store.error')} testID="paywall.offer-error" />
            <Button
              label={t('store.retry')}
              size="sm"
              variant="secondary"
              onPress={() => void offering.refetch()}
              testID="paywall.offer-retry"
            />
          </View>
        ) : (
          <>
            {annual ? planCard(annual, 'annual') : null}
            {monthly ? planCard(monthly, 'monthly') : null}
          </>
        )}
      </View>

      {!online ? <InlineMessage tone="info" message={t('store.offline')} /> : null}
      {message ? (
        <InlineMessage
          tone={message === 'failed' || message === 'nothingToRestore' ? 'warning' : 'success'}
          message={t(`messages.${message}`)}
          testID={`paywall.message.${message}`}
        />
      ) : null}

      <Button
        label={chosen?.trial ? t('cta.trial') : t('cta.start')}
        fullWidth
        disabled={!chosen || !online}
        loading={buy.isPending}
        onPress={onBuy}
        testID="paywall.buy"
      />

      <View className="gap-2">
        <Text variant="caption" tone="muted">
          {t('fine.renewal')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('fine.safety')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={t('restore')}
            variant="link"
            size="sm"
            loading={restore.isPending}
            disabled={!storeAvailable || !online}
            onPress={onRestore}
            testID="paywall.restore"
          />
          <Button
            label={t('fine.terms')}
            variant="link"
            size="sm"
            onPress={() => void Linking.openURL(TERMS_URL)}
          />
          <Button
            label={t('fine.privacy')}
            variant="link"
            size="sm"
            onPress={() => void Linking.openURL(PRIVACY_URL)}
          />
        </View>
      </View>
    </Screen>
  );
}
