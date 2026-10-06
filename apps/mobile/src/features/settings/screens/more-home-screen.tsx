import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useDebugMenuEnabled } from '@/features/debug';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import type { MoreScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

import { LanguageToggle } from '../components/language-toggle';
import { ThemeToggle } from '../components/theme-toggle';

/**
 * M1 More: trackers (water, fasting, weight, budget; Sprint 4; the Ramadan planner, Sprint 5),
 * account, Premium, AI memory and notification settings,
 * appearance and language, feedback, plus the hidden debug entry.
 */
export function MoreHomeScreen({ navigation }: MoreScreenProps<'MoreHome'>) {
  const { t } = useTranslation(['navigation', 'settings']);
  const debugEnabled = useDebugMenuEnabled();
  const ramadanEnabled = useFeatureFlag('ramadan_planner');
  const isDevGuest = useSessionStore((s) => s.isDevGuest);
  const signOut = useSessionStore((s) => s.setSignedOut);

  return (
    <Screen
      title={t('navigation:screens.moreHome')}
      edges={['top']}
      testID="settings-more-home.screen"
    >
      <Card testID="settings-more-home.track">
        <Text variant="overline" tone="muted">
          {t('settings:home.track')}
        </Text>
        <View className="gap-2">
          <Button
            label={t('settings:home.hydration')}
            variant="secondary"
            onPress={() => navigation.navigate('HydrationTracker', {})}
            testID="settings-more-home.hydration-button"
          />
          <Button
            label={t('settings:home.fasting')}
            variant="secondary"
            onPress={() => navigation.navigate('FastingTracker', {})}
            testID="settings-more-home.fasting-button"
          />
          {ramadanEnabled ? (
            <Button
              label={t('settings:home.ramadan')}
              variant="secondary"
              onPress={() => navigation.navigate('RamadanPlanner', {})}
              testID="settings-more-home.ramadan-button"
            />
          ) : null}
          <Button
            label={t('settings:home.weight')}
            variant="secondary"
            onPress={() => navigation.navigate('WeightLog', {})}
            testID="settings-more-home.weight-button"
          />
          <Button
            label={t('settings:home.budget')}
            variant="secondary"
            onPress={() => navigation.navigate('BudgetDashboard', {})}
            testID="settings-more-home.budget-button"
          />
        </View>
      </Card>
      {!isDevGuest ? (
        <Card>
          <Text variant="overline" tone="muted">
            {t('settings:home.account')}
          </Text>
          <Button
            label={t('settings:home.open')}
            variant="secondary"
            onPress={() => navigation.navigate('Settings')}
            testID="settings-more-home.settings-button"
          />
          <Button
            label={t('settings:home.notifications')}
            variant="secondary"
            onPress={() => navigation.navigate('SettingsNotifications')}
            testID="settings-more-home.notifications-button"
          />
          <Button
            label={t('settings:home.premium')}
            variant="secondary"
            onPress={() => navigation.navigate('Subscription')}
            testID="settings-more-home.premium-button"
          />
          <Button
            label={t('settings:home.memory')}
            variant="secondary"
            onPress={() => navigation.navigate('SettingsMemory')}
            testID="settings-more-home.memory-button"
          />
        </Card>
      ) : null}
      <Card>
        <Text variant="overline" tone="muted">
          {t('settings:appearance.title')}
        </Text>
        <ThemeToggle />
      </Card>
      <Card>
        <LanguageToggle />
      </Card>
      <Card>
        <Text variant="overline" tone="muted">
          {t('settings:feedback.title')}
        </Text>
        <Text tone="muted">{t('settings:feedback.body')}</Text>
        <Button
          label={t('settings:feedback.open')}
          variant="secondary"
          onPress={() => navigation.navigate('AlphaFeedback')}
          testID="settings-more-home.feedback-button"
        />
      </Card>
      {debugEnabled || isDevGuest ? (
        <Card>
          <Text variant="overline" tone="muted">
            {t('settings:developer.title')}
          </Text>
          <View className="gap-2">
            {debugEnabled ? (
              <Button
                label={t('settings:developer.openDebug')}
                variant="secondary"
                onPress={() => navigation.navigate('Debug')}
                testID="settings-more-home.debug-button"
              />
            ) : null}
            {isDevGuest ? (
              <Button
                label={t('settings:developer.signOutGuest')}
                variant="ghost"
                onPress={signOut}
                testID="settings-more-home.sign-out-guest-button"
              />
            ) : null}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
