import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';

export const PARENT_JOBS = ['what', 'when', 'where', 'company'] as const;
export const CHILD_JOBS = ['whether', 'howMuch'] as const;
export const SCRIPT_KEYS = [
  'refuses',
  'onlyWants',
  'reward',
  'grazing',
  'newFood',
  'sweets',
  'cleanPlate',
  'sibling',
] as const;

/**
 * Division of Responsibility guide (Satter; 15 §4.2, FR-PCK-01). The parent's jobs, the child's
 * jobs and short scripts to say instead of pressure, praise-for-eating or bribes. Content is drafted
 * in English and Urdu and is marked for the content team's review in locales/README.md.
 */
export function DivisionOfResponsibilityScreen() {
  const { t } = useTranslation('picky');
  useEffect(() => {
    track('dor_guide_viewed', {});
  }, []);
  return (
    <Screen testID="dor.screen">
      <Text variant="title" accessibilityRole="header">
        {t('dor.title')}
      </Text>
      <Text>{t('dor.intro')}</Text>
      <Card variant="outlined">
        <Text variant="heading" accessibilityRole="header">
          {t('dor.parentTitle')}
        </Text>
        {PARENT_JOBS.map((k) => (
          <Text key={k}>{t('dor.bullet', { text: t(`dor.parent.${k}`) })}</Text>
        ))}
      </Card>
      <Card variant="outlined">
        <Text variant="heading" accessibilityRole="header">
          {t('dor.childTitle')}
        </Text>
        {CHILD_JOBS.map((k) => (
          <Text key={k}>{t('dor.bullet', { text: t(`dor.child.${k}`) })}</Text>
        ))}
      </Card>
      <Text variant="heading" accessibilityRole="header">
        {t('dor.scriptsTitle')}
      </Text>
      {SCRIPT_KEYS.map((k) => (
        <Card key={k} variant="filled" testID={`dor.script.${k}`}>
          <Text variant="bodyStrong">{t(`dor.scripts.${k}.when`)}</Text>
          <View className="gap-1">
            <Text>{t('dor.try', { text: t(`dor.scripts.${k}.say`) })}</Text>
            <Text tone="muted">{t('dor.instead', { text: t(`dor.scripts.${k}.avoid`) })}</Text>
          </View>
        </Card>
      ))}
      <Text variant="caption" tone="muted">
        {t('dor.source')}
      </Text>
    </Screen>
  );
}
