import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { env } from '@/lib/env';

export const REVIEWER_ROLES = [
  'clinical',
  'paediatric',
  'feeding',
  'islamic',
  'urdu',
  'privacy',
] as const;

/**
 * About (S6-12): what Thuluth is, who reviews its content (roles only; reviewer names are added
 * when the reviewers sign off) and the version.
 */
export function AboutScreen() {
  const { t } = useTranslation('help');
  return (
    <Screen testID="about.screen">
      <Text variant="title" accessibilityRole="header">
        {t('about.title')}
      </Text>
      <Text>{t('about.body')}</Text>
      <Card variant="outlined" testID="about.reviewers">
        <Text variant="heading" accessibilityRole="header">
          {t('about.reviewersTitle')}
        </Text>
        <Text tone="muted">{t('about.reviewersBody')}</Text>
        <View className="gap-2">
          {REVIEWER_ROLES.map((r) => (
            <View key={r} testID={`about.role.${r}`}>
              <Text variant="bodyStrong">{t(`about.roles.${r}.title`)}</Text>
              <Text variant="caption" tone="muted">
                {t(`about.roles.${r}.scope`)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <Text tone="muted">{t('about.sources')}</Text>
      <Text variant="caption" tone="muted" testID="about.version">
        {t('about.version', { version: env.APP_VERSION })}
      </Text>
    </Screen>
  );
}
