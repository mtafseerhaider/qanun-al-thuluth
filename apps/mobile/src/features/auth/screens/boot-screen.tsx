import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useThemeColors } from '@/theme/use-theme-colors';

/** B1: shown while the session status is `initializing` (the native splash usually covers it). */
export function BootScreen() {
  const { t } = useTranslation('common');
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center bg-surface" testID="auth-boot.screen">
      <ActivityIndicator color={colors.primary} accessibilityLabel={t('loading')} />
    </View>
  );
}
