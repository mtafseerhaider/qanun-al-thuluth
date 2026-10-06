import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  moveLadder,
  nextLadderAction,
  useExposures,
  useLadder,
  useModuleMember,
  useMoveLadder,
  useSetLadderStatus,
} from '@/features/exposures';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { FamilyScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

/**
 * One ladder (02 §7.10.4, FR-AUT-03). The current step, tries logged at it, and the app's
 * suggestion (move up after 3 calm tries, step back after two "Not today" in a row). The parent
 * always confirms a move; nothing advances silently.
 */
export function ExposureLadderDetailScreen({
  route,
  navigation,
}: FamilyScreenProps<'ExposureLadderDetail'>) {
  const { ladderId } = route.params;
  const { t } = useTranslation('autism');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const ladder = useLadder(householdId, ladderId);
  const l = ladder.data ?? null;
  const m = useModuleMember(l?.familyMemberId ?? '');
  const exposures = useExposures(householdId, l?.familyMemberId ?? null, m.today);
  const move = useMoveLadder(householdId);
  const setStatus = useSetLadderStatus(householdId);

  if (!l)
    return (
      <Screen testID="ladder.screen">
        <Text tone="muted">{ladder.isLoading ? t('loading') : t('ladder.missing')}</Text>
      </Screen>
    );

  const current = l.steps.find((s) => s.stepNo === l.currentStep) ?? null;
  const tries = current ? exposures.rows.filter((e) => e.ladderStepId === current.id) : [];
  const suggestion = current ? nextLadderAction(current.stage, tries) : 'stay';
  const active = l.status === 'active';

  const confirmMove = (direction: 'up' | 'down') => {
    const next = moveLadder(l, direction);
    Alert.alert(
      direction === 'up' ? t('ladder.upTitle') : t('ladder.downTitle'),
      direction === 'up'
        ? next.status === 'completed'
          ? t('ladder.completeBody', { food: l.targetLabel })
          : t('ladder.upBody')
        : t('ladder.downBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('ladder.confirm'),
          onPress: () => move.mutate({ ladder: l, next, direction, today: m.today }),
        },
      ],
    );
  };
  const confirmRemove = () =>
    Alert.alert(t('ladder.removeTitle'), t('ladder.removeBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('ladder.remove'),
        style: 'destructive',
        onPress: () =>
          setStatus.mutate(
            { ladderId: l.id, status: 'abandoned' },
            { onSuccess: () => navigation.goBack() },
          ),
      },
    ]);

  const error = move.error ?? setStatus.error;
  return (
    <Screen testID="ladder.screen">
      <Text variant="title" accessibilityRole="header">
        {t('ladder.title', { food: l.targetLabel })}
      </Text>
      <Text tone="muted">
        {t(l.strategy === 'food_chaining' ? 'ladder.chain' : 'ladder.exposure', {
          status: t(`ladders.status.${l.status}`),
        })}
      </Text>
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
      {current && active ? (
        <Card variant="elevated" testID="ladder.current">
          <Text variant="overline" tone="muted">
            {t('ladder.stepOf', { step: l.currentStep, total: l.steps.length })}
          </Text>
          <Text variant="heading">
            {t('ladder.stepLine', {
              stage: t(`picky:stages.${current.stage}`),
              food: current.foodLabel,
            })}
          </Text>
          {current.criteria ? <Text>{current.criteria}</Text> : null}
          <Text tone="muted" testID="ladder.tries">
            {t('ladder.tries', { count: tries.length })}
          </Text>
          <Text testID={`ladder.suggestion.${suggestion}`}>
            {t(`ladder.suggestion.${suggestion}`)}
          </Text>
          {m.canEdit ? (
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={t('ladder.logTry')}
                size="sm"
                onPress={() =>
                  navigation.navigate('LogExposureSheet', {
                    familyMemberId: l.familyMemberId,
                    module: 'autism',
                    ladderStepId: current.id,
                    stage: current.stage,
                    ...(current.foodLabel === l.targetLabel
                      ? { ingredientId: l.targetIngredientId, foodLabel: l.targetLabel }
                      : {}),
                  })
                }
                testID="ladder.log"
              />
              <Button
                label={t('ladder.up')}
                size="sm"
                variant="secondary"
                onPress={() => confirmMove('up')}
                testID="ladder.up"
              />
              {l.currentStep > 1 ? (
                <Button
                  label={t('ladder.down')}
                  size="sm"
                  variant="ghost"
                  onPress={() => confirmMove('down')}
                  testID="ladder.down"
                />
              ) : null}
            </View>
          ) : null}
        </Card>
      ) : null}
      {l.status === 'completed' ? (
        <InlineMessage tone="success" message={t('ladder.completed', { food: l.targetLabel })} />
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {t('ladder.steps')}
      </Text>
      {l.steps.map((s) => (
        <View
          key={s.id}
          className="min-h-control flex-row items-center gap-3 border-b border-line py-2"
          accessible
          accessibilityLabel={t('ladder.stepA11y', {
            n: s.stepNo,
            stage: t(`picky:stages.${s.stage}`),
            food: s.foodLabel,
            state: s.completedOn
              ? t('ladder.done')
              : s.stepNo === l.currentStep
                ? t('ladder.current')
                : '',
          })}
          testID={`ladder.step-${s.stepNo}`}
        >
          <Text variant="bodyStrong">{s.completedOn ? '✓' : String(s.stepNo)}</Text>
          <View className="flex-1">
            <Text variant={s.stepNo === l.currentStep ? 'bodyStrong' : 'body'}>
              {t('ladder.stepLine', { stage: t(`picky:stages.${s.stage}`), food: s.foodLabel })}
            </Text>
          </View>
        </View>
      ))}
      {m.canEdit ? (
        <View className="flex-row flex-wrap gap-2">
          {l.status === 'active' || l.status === 'paused' ? (
            <Button
              label={active ? t('ladder.pause') : t('ladder.resume')}
              variant="secondary"
              onPress={() =>
                setStatus.mutate({ ladderId: l.id, status: active ? 'paused' : 'active' })
              }
              testID="ladder.pause"
            />
          ) : null}
          <Button
            label={t('ladder.edit')}
            variant="secondary"
            onPress={() =>
              navigation.navigate('FoodChaining', {
                familyMemberId: l.familyMemberId,
                ladderId: l.id,
              })
            }
            testID="ladder.edit"
          />
          <Button
            label={t('ladder.remove')}
            variant="ghost"
            onPress={confirmRemove}
            testID="ladder.remove"
          />
        </View>
      ) : null}
    </Screen>
  );
}
