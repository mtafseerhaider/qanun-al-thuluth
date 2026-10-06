import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import type { RootScreenProps } from '@/navigation/types';

import { setSensoryCalmByUser } from '../utils/sensory-calm';

/**
 * One-time Sensory-calm suggestion (02 §7.10), opened by `useSensoryCalmSuggestion` the first time
 * the autism module is on for a member. Calm by design: plain text, no icon or illustration, no
 * motion beyond the sheet itself (which crossfades under reduced motion), and "Not now" is as easy
 * as "Turn on". Swiping the sheet down is the same as "Not now".
 */
export function SensoryCalmSuggestionSheet({
  navigation,
}: RootScreenProps<'SensoryCalmSuggestionSheet'>) {
  const { t } = useTranslation('settings');
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };
  return (
    <Screen title={t('sensoryCalmSuggestion.title')} testID="sensory-calm-suggestion.screen">
      <Text>{t('sensoryCalmSuggestion.body')}</Text>
      <Text tone="muted">{t('sensoryCalmSuggestion.where')}</Text>
      <View className="gap-3">
        <Button
          label={t('sensoryCalmSuggestion.turnOn')}
          onPress={() => {
            setSensoryCalmByUser(true);
            close();
          }}
          testID="sensory-calm-suggestion.turn-on"
        />
        <Button
          label={t('sensoryCalmSuggestion.notNow')}
          variant="secondary"
          onPress={close}
          testID="sensory-calm-suggestion.not-now"
        />
      </View>
    </Screen>
  );
}
