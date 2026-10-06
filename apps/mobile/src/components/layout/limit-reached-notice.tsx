import { useTranslation } from 'react-i18next';

import { FREE_LIMITS, PREMIUM_LIMITS } from '@shared';

import { InlineMessage } from '@/components/ui/inline-message';

/**
 * Upgrade copy for `LIMIT_REACHED` from the tier triggers (00 §8, FR-ONB-06). Calm and honest (P9):
 * it states the limit and what Premium allows. The paywall itself lands with subscriptions (Sprint 5).
 */
export function LimitReachedNotice({
  resource,
  testID = 'limit-reached',
}: {
  resource: 'households' | 'family_members' | string;
  testID?: string;
}) {
  const { t } = useTranslation('common');
  const body =
    resource === 'households'
      ? t('limit.households', { free: FREE_LIMITS.households })
      : t('limit.familyMembers', {
          free: FREE_LIMITS.membersPerHousehold,
          premium: PREMIUM_LIMITS.membersPerHousehold,
        });
  return <InlineMessage tone="warning" title={t('limit.title')} message={body} testID={testID} />;
}
