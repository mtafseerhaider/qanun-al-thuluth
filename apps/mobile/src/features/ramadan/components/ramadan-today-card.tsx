import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useCountdown } from '@/hooks/use-countdown';
import { track } from '@/lib/analytics/track';

import { useRamadanToday } from '../hooks/use-ramadan';
import { formatHms, ramadanMoment } from '../utils/ramadan-rules';

/**
 * Ramadan Today variant (02 §7.5.1, 24 S5-11): "Ramadan day N", suhoor end and iftar for the
 * household's city (shared prayer module) and a calm countdown to the next one. Hidden outside
 * Ramadan, when the city is unknown, or while the `ramadan_planner` flag is off.
 */
export function RamadanTodayCard({
  householdId,
  onOpen,
}: {
  householdId: string | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation('ramadan');
  const r = useRamadanToday(householdId);
  const moment = r.times ? ramadanMoment(r.times, Date.now()) : null;
  const seconds = useCountdown(moment?.targetMs ?? null);
  if (r.day === null || !r.times || !moment) return null;
  const countdown =
    moment.phase === 'before_fajr'
      ? t('today.untilSuhoorEnd', { time: formatHms(seconds) })
      : moment.phase === 'fasting'
        ? t('today.untilIftar', { time: formatHms(seconds) })
        : t('today.iftarDone');
  return (
    <Card
      variant="filled"
      onPress={() => {
        track('dashboard_section_tapped', { section: 'fasting' });
        onOpen();
      }}
      accessibilityLabel={`${t('today.day', { day: r.day })}. ${countdown}`}
      testID="today.ramadan"
    >
      <Text variant="overline" tone="primary">
        {t('today.day', { day: r.day })}
      </Text>
      <Text variant="heading" testID="today.ramadan.countdown">
        {countdown}
      </Text>
      <View className="flex-row flex-wrap gap-4">
        <Text tone="muted">{t('today.suhoorEnds', { time: r.times.suhoorEnd })}</Text>
        <Text tone="muted">{t('today.iftarAt', { time: r.times.iftar })}</Text>
      </View>
    </Card>
  );
}
