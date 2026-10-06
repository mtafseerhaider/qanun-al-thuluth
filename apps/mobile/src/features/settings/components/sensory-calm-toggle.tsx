import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { usePreferencesStore } from '@/stores/use-preferences-store';

/**
 * Sensory-calm mode (01 §9.3 autism-friendly mode, 03 §6, 02 §7.13): a quieter palette, no
 * motion and no sounds on this device. The whole row is one switch for screen readers, with the
 * explanation read as its hint.
 */
export function SensoryCalmToggle({ testID = 'settings.sensory-calm' }: { testID?: string }) {
  const { t } = useTranslation('settings');
  const calm = usePreferencesStore((s) => s.sensoryCalm);
  const setCalm = usePreferencesStore((s) => s.setSensoryCalm);
  return (
    <View className="min-h-touch flex-row items-center justify-between gap-3">
      <View className="flex-1 gap-1" importantForAccessibility="no-hide-descendants">
        <Text variant="bodyStrong">{t('accessibility.sensoryCalm')}</Text>
        <Text variant="caption" tone="muted">
          {t('accessibility.sensoryCalmHint')}
        </Text>
      </View>
      <Switch
        value={calm}
        onValueChange={setCalm}
        accessibilityLabel={t('accessibility.sensoryCalm')}
        accessibilityHint={t('accessibility.sensoryCalmHint')}
        testID={testID}
      />
    </View>
  );
}
