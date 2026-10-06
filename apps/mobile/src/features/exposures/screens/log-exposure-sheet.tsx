import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceScore, ExposureStage } from '@shared';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { AcceptanceScorePicker, useHouseholdClock } from '@/features/meals';
import type { RootScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import type { IngredientLite } from '../api/exposures-api';
import { IngredientPicker } from '../components/ingredient-picker';
import { logExposure } from '../hooks/use-exposures';
import {
  EXPOSURE_CONTEXTS,
  STAGES,
  stageForAcceptance,
  type ExposureContext,
} from '../utils/exposure-rules';

/**
 * Log a food try (02 §7.11.3, §7.10.4; FR-PCK-04, FR-AUT-03). Pick the food, how it went and,
 * optionally, the stage and where it happened. The try is queued in the outbox, so it saves offline.
 * Calm copy: "Not today" is a normal answer and nothing is ever framed as failure.
 */
export function LogExposureSheet({ route, navigation }: RootScreenProps<'LogExposureSheet'>) {
  const {
    familyMemberId,
    module,
    ingredientId,
    foodLabel,
    ladderStepId,
    stage: fixedStage,
  } = route.params;
  const { t } = useTranslation('picky');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const member = (members.data ?? []).find((m) => m.id === familyMemberId) ?? null;
  const [food, setFood] = useState<IngredientLite | null>(
    ingredientId
      ? { id: ingredientId, label: foodLabel ?? '', nameI18n: {}, textures: [], color: null }
      : null,
  );
  const [acceptance, setAcceptance] = useState<AcceptanceScore | null>(null);
  const [stage, setStage] = useState<ExposureStage | null>(fixedStage ?? null);
  const [context, setContext] = useState<ExposureContext | null>(null);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);

  const save = () => {
    setTouched(true);
    if (!householdId || !food || !acceptance) return;
    logExposure(
      {
        householdId,
        familyMemberId,
        ingredientId: food.id,
        foodLabel: food.label,
        exposedOn: clock.today,
        stage: stage ?? stageForAcceptance(acceptance),
        acceptance,
        context,
        ladderStepId: ladderStepId ?? null,
        notes: notes.trim() ? notes.trim().slice(0, 2000) : null,
      },
      module,
    );
    navigation.goBack();
  };

  const name = member?.name ?? '';
  return (
    <Screen testID="log-exposure.screen">
      <Text variant="title" accessibilityRole="header">
        {t('log.title', { name })}
      </Text>
      {!canEdit ? <InlineMessage tone="info" message={t('log.viewer')} /> : null}
      <IngredientPicker
        label={t('log.food')}
        selected={food}
        onSelect={setFood}
        testID="log-exposure.food"
      />
      {touched && !food ? <InlineMessage tone="danger" message={t('log.needFood')} /> : null}
      <AcceptanceScorePicker
        label={t('log.howItWent', { name })}
        value={acceptance}
        onChange={setAcceptance}
        testID="log-exposure.acceptance"
      />
      {touched && !acceptance ? <InlineMessage tone="danger" message={t('log.needScore')} /> : null}
      {fixedStage ? (
        <Text tone="muted" testID="log-exposure.stage-fixed">
          {t('log.stageFixed', { stage: t(`stages.${fixedStage}`) })}
        </Text>
      ) : (
        <ChipGroup
          label={t('log.stage')}
          hint={t('log.stageHint')}
          single
          options={STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))}
          selected={stage ? [stage] : []}
          onToggle={(s) => setStage((cur) => (cur === s ? null : s))}
          testID="log-exposure.stage"
        />
      )}
      <ChipGroup
        label={t('log.context')}
        single
        options={EXPOSURE_CONTEXTS.map((c) => ({ value: c, label: t(`contexts.${c}`) }))}
        selected={context ? [context] : []}
        onToggle={(c) => setContext((cur) => (cur === c ? null : c))}
        testID="log-exposure.context"
      />
      <Input
        label={t('log.notes')}
        helperText={t('log.notesHint')}
        value={notes}
        onChangeText={setNotes}
        variant="multiline"
        maxLength={2000}
        testID="log-exposure.notes"
      />
      <Text variant="caption" tone="muted">
        {t('log.calm')}
      </Text>
      <Button
        label={t('log.save')}
        onPress={save}
        disabled={!canEdit || !member}
        fullWidth
        testID="log-exposure.save"
      />
    </Screen>
  );
}
