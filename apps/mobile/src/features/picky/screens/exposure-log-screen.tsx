import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  groupByFood,
  safeFoodSuggestions,
  useExposures,
  useModuleMember,
  useSafeFoods,
  useSaveSafeFood,
} from '@/features/exposures';
import { QueuedBadge } from '@/features/meals';
import type { FamilyScreenProps } from '@/navigation/types';

/**
 * Exposure log by food (02 §7.11.3, FR-PCK-04, -05): every food tried in the last 90 days with
 * its new-food stage (introduced, exposing, tasting, accepted, paused). Accepted foods can become
 * safe foods with one tap; a paused food suggests trying a food chain instead of more of the same.
 */
export function ExposureLogScreen({ route, navigation }: FamilyScreenProps<'ExposureLog'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('picky');
  const m = useModuleMember(familyMemberId);
  const exposures = useExposures(m.householdId, familyMemberId, m.today);
  const safe = useSafeFoods(m.householdId, familyMemberId);
  const saveSafe = useSaveSafeFood(m.householdId, familyMemberId);
  const foods = useMemo(() => groupByFood(exposures.rows, m.today), [exposures.rows, m.today]);
  const safeIds = useMemo(
    () => new Set((safe.data ?? []).flatMap((s) => (s.ingredientId ? [s.ingredientId] : []))),
    [safe.data],
  );
  const suggestions = safeFoodSuggestions(foods, safeIds);

  return (
    <Screen
      testID="exposure-log.screen"
      refreshing={exposures.isRefetching}
      onRefresh={() => void exposures.refetch()}
    >
      <Text variant="title" accessibilityRole="header">
        {t('exposureLog.title', { name: m.name })}
      </Text>
      {m.canEdit ? (
        <Button
          label={t('hub.logTry')}
          onPress={() =>
            navigation.navigate('LogExposureSheet', { familyMemberId, module: 'picky' })
          }
          fullWidth
          testID="exposure-log.add"
        />
      ) : null}
      {suggestions.length > 0 && m.canEdit ? (
        <Card variant="elevated" testID="exposure-log.suggestions">
          <Text variant="bodyStrong">{t('exposureLog.suggestTitle')}</Text>
          {suggestions.map((s) => (
            <View
              key={s.ingredientId}
              className="flex-row flex-wrap items-center justify-between gap-2"
            >
              <Text>{s.foodLabel}</Text>
              <Button
                label={t('exposureLog.makeSafe')}
                size="sm"
                variant="secondary"
                loading={saveSafe.isPending}
                onPress={() =>
                  saveSafe.mutate({
                    label: s.foodLabel,
                    ingredientId: s.ingredientId,
                    strength: 2,
                    source: 'suggestion',
                  })
                }
                testID="exposure-log.make-safe"
              />
            </View>
          ))}
        </Card>
      ) : null}
      {foods.length === 0 ? (
        <Text tone="muted" testID="exposure-log.empty">
          {t('exposureLog.empty', { name: m.name })}
        </Text>
      ) : (
        foods.map((f) => (
          <Card key={f.ingredientId} variant="outlined" testID="exposure-log.food">
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="bodyStrong">{f.foodLabel}</Text>
              {f.last.queued ? <QueuedBadge /> : null}
            </View>
            <Text tone="muted">
              {t('exposureLog.line', {
                count: f.count,
                stage: t(`lifecycle.${f.lifecycle}`),
                last: t(`meals:acceptance.${f.last.acceptance}`),
                date: f.last.exposedOn,
              })}
            </Text>
            {f.lifecycle === 'paused' ? (
              <Text variant="caption" tone="muted">
                {t('exposureLog.pausedHint')}
              </Text>
            ) : null}
          </Card>
        ))
      )}
      <Text variant="caption" tone="muted">
        {t('exposureLog.note')}
      </Text>
    </Screen>
  );
}
