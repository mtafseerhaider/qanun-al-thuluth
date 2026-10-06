import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { GrowthAlertCode } from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';

import { PLAN_PAUSING } from '../utils/growth-rules';

/**
 * Paediatrician alert (02 §7.9 X10, 15 §2.8, FR-GRW-04). Calm copy, never the child's fault, no
 * diet advice for a high BMI-for-age (family habits and a clinician only). Shown on every tier for
 * safety alerts (P1). Red flags carry the plan-paused banner: new growth plans wait for a doctor,
 * everyday meals stay the same.
 */
export function GrowthAlertCard({
  name,
  alerts,
  acknowledged,
  onAcknowledge,
  onExport,
  onShowChart,
  testID = 'growth.alert',
}: {
  name: string;
  alerts: readonly GrowthAlertCode[];
  acknowledged: boolean;
  onAcknowledge: () => void;
  onExport?: (() => void) | undefined;
  onShowChart?: (() => void) | undefined;
  testID?: string;
}) {
  const { t } = useTranslation('growth');
  if (alerts.length === 0) return null;
  const redFlag = alerts.some((a) => PLAN_PAUSING.has(a));
  return (
    <View className="gap-3" testID={testID}>
      {redFlag ? (
        <InlineMessage
          tone="warning"
          title={t('alert.pausedTitle')}
          message={t('alert.pausedBody', { name })}
          testID="growth.plan-paused"
        />
      ) : null}
      <Card variant={redFlag ? 'outlined' : 'filled'} testID={`${testID}.card`}>
        <Text variant="heading" accessibilityRole="header">
          {redFlag ? t('alert.redFlagTitle') : t('alert.watchTitle')}
        </Text>
        {alerts.map((code) => (
          <Text key={code} testID={`${testID}.${code}`}>
            {t(`alert.codes.${code}`, { name })}
          </Text>
        ))}
        {redFlag ? (
          <Text tone="muted" testID={`${testID}.what-to-do`}>
            {t('alert.whatToDo')}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {onExport ? (
            <Button
              label={t('alert.export')}
              size="sm"
              variant="secondary"
              onPress={onExport}
              testID={`${testID}.export`}
            />
          ) : null}
          {onShowChart ? (
            <Button
              label={t('alert.showChart')}
              size="sm"
              variant="secondary"
              onPress={onShowChart}
              testID={`${testID}.show-chart`}
            />
          ) : null}
          {!acknowledged ? (
            <Button
              label={t('alert.understand')}
              size="sm"
              variant="ghost"
              onPress={onAcknowledge}
              testID={`${testID}.acknowledge`}
            />
          ) : null}
        </View>
      </Card>
    </View>
  );
}
