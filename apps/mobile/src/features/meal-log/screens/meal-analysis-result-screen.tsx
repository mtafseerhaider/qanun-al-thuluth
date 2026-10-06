import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { PlateMini } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import type { RootScreenProps } from '@/navigation/types';

import { logMealLog } from '../hooks/use-meal-log';
import { useMealAnalysisStore } from '../store/use-meal-analysis-store';
import {
  analysisView,
  countEdits,
  describeItems,
  editableItems,
  estimatedNutrition,
  fullnessFor,
  type EditableItem,
} from '../utils/meal-log-rules';

const FULLNESS = ['0', '2', '4', '6', '8', '10'] as const;

/**
 * X4 Meal Analysis Result (02 §7.7.4, 24 S5-08, FR-TRK-03): "Here's what we see. Fix anything we
 * got wrong." Detected foods with Sure / Not sure (low-confidence items start unchecked), edit,
 * remove and add; the plate compared with the plate method; Thuluth feedback; the adult-only
 * nutrition table and fullness scale. For anyone under 18 no kcal, macros or grams are shown or
 * stored. Save writes `meal_logs` (`source = 'photo_ai'`) through the outbox.
 */
export function MealAnalysisResultScreen({
  route,
  navigation,
}: RootScreenProps<'MealAnalysisResult'>) {
  const { t } = useTranslation('mealLog');
  const draft = useMealAnalysisStore((s) => s.drafts[route.params.analysisId]);
  const drop = useMealAnalysisStore((s) => s.drop);
  const original = useMemo(() => (draft ? editableItems(draft.result) : []), [draft]);
  const [items, setItems] = useState<EditableItem[]>(original);
  const [fullBefore, setFullBefore] = useState<number | null>(null);
  const [fullAfter, setFullAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setItems(original), [original]);

  if (!draft)
    return (
      <Screen testID="meal-analysis.screen">
        <InlineMessage tone="info" message={t('result.missing')} testID="meal-analysis.missing" />
        <Button label={t('result.close')} onPress={() => navigation.goBack()} />
      </Screen>
    );

  const view = analysisView(draft.result, draft.minor);
  const update = (key: string, patch: Partial<EditableItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const save = () => {
    logMealLog({
      id: draft.mealLogId,
      householdId: draft.householdId,
      familyMemberId: draft.memberId,
      eatenAt: draft.eatenAt,
      mealType: draft.mealType,
      description: describeItems(items, draft.note),
      photoPath: draft.photoPath,
      estimatedNutrition: estimatedNutrition(draft.result, items, draft.minor),
      fullnessBefore: fullnessFor(draft.minor, fullBefore),
      fullnessAfter: fullnessFor(draft.minor, fullAfter),
      source: 'photo_ai',
      loggedByUserId: null,
    });
    const edits = countEdits(original, items);
    if (edits > 0) track('meal_analysis_edited', { edits });
    setSaved(true);
    drop(draft.analysisId);
    navigation.goBack();
  };

  return (
    <Screen testID="meal-analysis.screen">
      <Text variant="title" accessibilityRole="header">
        {t('result.title')}
      </Text>
      <Text tone="muted">{t('result.subtitle')}</Text>
      <Image
        source={{ uri: draft.photoUri }}
        accessibilityIgnoresInvertColors
        accessibilityLabel={t('capture.previewA11y')}
        className="h-48 w-full rounded-lg"
        resizeMode="cover"
        resizeMethod="resize"
      />

      {view.confidence === 'low' ? (
        <InlineMessage tone="info" message={t('result.lowConfidence')} testID="meal-analysis.low" />
      ) : null}

      <View className="gap-3" testID="meal-analysis.items">
        {items.map((i, idx) => (
          <Card key={i.key} variant="outlined" padding="sm" testID={`meal-analysis.item-${idx}`}>
            <Checkbox
              label={i.label || t('result.unnamed')}
              description={[
                i.measure,
                view.showNumbers ? t('result.grams', { grams: i.grams }) : null,
                i.sure ? t('result.sure') : t('result.notSure'),
              ]
                .filter(Boolean)
                .join(' · ')}
              checked={i.included}
              onChange={(included) => update(i.key, { included })}
              testID={`meal-analysis.item-${idx}.include`}
            />
            {i.included ? (
              <View className="gap-2">
                <Input
                  label={t('result.foodLabel')}
                  value={i.label}
                  onChangeText={(label) => update(i.key, { label: label.slice(0, 120) })}
                  testID={`meal-analysis.item-${idx}.label`}
                />
                {view.showNumbers ? (
                  <Input
                    label={t('result.gramsLabel')}
                    value={String(i.grams)}
                    variant="numeric"
                    unit={t('result.gramsUnit')}
                    onChangeText={(v) => {
                      const n = Number.parseInt(v.replace(/\D/g, ''), 10);
                      update(i.key, { grams: Number.isFinite(n) ? Math.min(2000, n) : 0 });
                    }}
                    testID={`meal-analysis.item-${idx}.grams`}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
        ))}
        <Button
          label={t('result.addFood')}
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={() =>
            setItems((list) => [
              ...list,
              {
                key: `added-${Crypto.randomUUID()}`,
                label: '',
                grams: 100,
                measure: null,
                sure: true,
                included: true,
                added: true,
              },
            ])
          }
          testID="meal-analysis.add"
        />
      </View>

      <Card variant="filled" testID="meal-analysis.feedback">
        <View className="flex-row items-center gap-3">
          <PlateMini split={view.plate} size={48} />
          <Text variant="bodyStrong" className="flex-1">
            {view.feedback.headline}
          </Text>
        </View>
        {view.feedback.points.map((p) => (
          <Text key={p}>{t('result.point', { text: p })}</Text>
        ))}
        <Text variant="caption" tone="muted">
          {t('result.plateCompare')}
        </Text>
      </Card>

      {view.nutrition ? (
        <Card variant="outlined" testID="meal-analysis.nutrition">
          <Text variant="bodyStrong">{t('result.nutritionTitle')}</Text>
          <Text>{t('result.kcal', { value: Math.round(view.nutrition.kcal) })}</Text>
          <Text>{t('result.protein', { value: Math.round(view.nutrition.protein_g) })}</Text>
          <Text>{t('result.carbs', { value: Math.round(view.nutrition.carbs_g) })}</Text>
          <Text>{t('result.fat', { value: Math.round(view.nutrition.fat_g) })}</Text>
          <Text>{t('result.fiber', { value: Math.round(view.nutrition.fiber_g) })}</Text>
          <Text variant="caption" tone="muted">
            {t('result.estimateNote')}
          </Text>
        </Card>
      ) : null}

      {draft.minor ? (
        <Text variant="caption" tone="muted" testID="meal-analysis.child-note">
          {t('result.childNote')}
        </Text>
      ) : (
        <View className="gap-3" testID="meal-analysis.fullness">
          <ChipGroup
            label={t('result.fullnessBefore')}
            hint={t('result.fullnessHint')}
            single
            options={FULLNESS.map((v) => ({ value: v, label: v }))}
            selected={fullBefore === null ? [] : [String(fullBefore)]}
            onToggle={(v) => setFullBefore(Number(v))}
            testID="meal-analysis.fullness-before"
          />
          <ChipGroup
            label={t('result.fullnessAfter')}
            single
            options={FULLNESS.map((v) => ({ value: v, label: v }))}
            selected={fullAfter === null ? [] : [String(fullAfter)]}
            onToggle={(v) => setFullAfter(Number(v))}
            testID="meal-analysis.fullness-after"
          />
        </View>
      )}

      <Button
        label={t('result.save')}
        fullWidth
        disabled={saved || !items.some((i) => i.included && i.label.trim())}
        onPress={save}
        testID="meal-analysis.save"
      />
      <Text variant="caption" tone="muted">
        {t('result.disclaimer')}
      </Text>
    </Screen>
  );
}
