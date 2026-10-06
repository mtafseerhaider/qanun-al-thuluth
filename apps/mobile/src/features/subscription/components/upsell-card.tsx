import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { PaywallTrigger } from '@/navigation/types';

import { usePaywall } from '../hooks/use-subscription';

/**
 * Calm premium preview with a single "See Premium" action (02 P9, 17 §5): no countdowns, no
 * discounts. `intent` is replayed after a purchase.
 */
export function UpsellCard({
  trigger,
  title,
  body,
  intent,
  testID,
}: {
  trigger: PaywallTrigger;
  title: string;
  body: string;
  intent?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation('subscription');
  const openPaywall = usePaywall();
  return (
    <Card variant="filled" {...(testID ? { testID } : {})}>
      <Text variant="bodyStrong">{title}</Text>
      <Text tone="muted">{body}</Text>
      <Button
        label={t('seePremium')}
        size="sm"
        variant="secondary"
        className="self-start"
        onPress={() => openPaywall(trigger, intent)}
        {...(testID ? { testID: `${testID}.see-premium` } : {})}
      />
    </Card>
  );
}

/** Small "Premium" label next to gated entries (02 §4.1 `PremiumBadge`). */
export function PremiumBadge({ testID }: { testID?: string }) {
  const { t } = useTranslation('subscription');
  return (
    <Text variant="caption" tone="primary" {...(testID ? { testID } : {})}>
      {t('badge')}
    </Text>
  );
}

/** Downgrade and billing banners (FR-SUB-06, 17 §10.2). */
export function DowngradeBanner({
  notice,
  testID = 'subscription.downgrade',
}: {
  notice: 'billing_issue' | 'ends_soon' | 'expired_read_only' | null;
  testID?: string;
}) {
  const { t } = useTranslation('subscription');
  if (!notice) return null;
  return (
    <Card variant="outlined" testID={`${testID}.${notice}`}>
      <Text variant="bodyStrong">{t(`downgrade.${notice}.title`)}</Text>
      <Text tone="muted">{t(`downgrade.${notice}.body`)}</Text>
    </Card>
  );
}
