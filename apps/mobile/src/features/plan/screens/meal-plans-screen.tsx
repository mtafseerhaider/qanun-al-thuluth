import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** Sprint 0 placeholder for `MealPlans` (02 §3.2). */
export function MealPlansScreen() {
  const { t } = useTranslation(['navigation', 'common']);
  return (
    <PlaceholderScreen
      title={t('navigation:screens.mealPlans')}
      body={t('common:comingSoon')}
      testID="plan-meal-plans.screen"
    />
  );
}
