import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ExposureStage } from '@shared';
import type { ExposureLadderStrategy } from '@shared/domain/family-modules';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  IngredientPicker,
  avoidColours,
  chainLadderSteps,
  exposureLadderSteps,
  parseLadderProposal,
  suggestChain,
  useChainCatalog,
  useLadder,
  useModuleMember,
  useSafeFoods,
  useSaveLadder,
  useSensoryProfile,
  type FoodFeatures,
  type IngredientLite,
  type LadderStepDraft,
} from '@/features/exposures';
import { UpsellCard } from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { FamilyScreenProps } from '@/navigation/types';

import { LadderStepsEditor } from '../components/ladder-steps-editor';

/**
 * Ladder and food-chain editor (02 §7.10.4 to §7.10.5, 15 §3.6; FR-AUT-03, -04; premium).
 * New ladder: pick the target food and get the nine-stage ladder. New chain: pick a safe food to
 * start from and the target; the app suggests 0 to 3 bridge foods by texture and colour, which the
 * parent can replace, reorder or remove. A ladder proposed in chat opens here prefilled and is saved
 * only when the parent taps Save.
 */
export function FoodChainingScreen({ route, navigation }: FamilyScreenProps<'FoodChaining'>) {
  const { familyMemberId, ladderId, proposal } = route.params;
  const { t } = useTranslation('autism');
  const m = useModuleMember(familyMemberId);
  const chainingOn = useFeatureFlag('autism.food_chaining');
  const existing = useLadder(m.householdId, ladderId ?? 'none');
  const parsed = useMemo(() => (proposal ? parseLadderProposal(proposal) : null), [proposal]);
  const [strategy, setStrategy] = useState<ExposureLadderStrategy>(
    parsed?.strategy ?? route.params.strategy ?? 'exposure_ladder',
  );
  const [target, setTarget] = useState<IngredientLite | null>(
    parsed?.targetIngredientId
      ? {
          id: parsed.targetIngredientId,
          label: parsed.targetFood,
          nameI18n: {},
          textures: [],
          color: null,
        }
      : null,
  );
  const [startId, setStartId] = useState<string | null>(null);
  const [links, setLinks] = useState<IngredientLite[]>([]);
  const [steps, setSteps] = useState<LadderStepDraft[]>(parsed?.steps ?? []);
  const [suggested, setSuggested] = useState(Boolean(parsed));
  const [noChain, setNoChain] = useState(false);
  const save = useSaveLadder(m.householdId);
  const safe = useSafeFoods(m.householdId, familyMemberId);
  const sensory = useSensoryProfile(m.householdId, familyMemberId);
  const catalog = useChainCatalog(strategy === 'food_chaining' && m.premium);
  const criteria = (stage: ExposureStage) => t(`criteria.${stage}`);

  useEffect(() => {
    if (existing.data && steps.length === 0) {
      setStrategy(existing.data.strategy);
      setSteps(existing.data.steps.map(({ id: _id, ...s }) => s));
    }
    // Load the saved ladder once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const editing = Boolean(ladderId);
  const safeStarts = (safe.data ?? []).filter((s) => s.ingredientId);
  const featuresOf = (id: string, label: string): FoodFeatures =>
    catalog.data?.find((c) => c.id === id) ?? { id, label, textures: [], color: null };

  const buildLadder = (food: IngredientLite) => {
    setSteps(exposureLadderSteps(food.label, criteria));
    setSuggested(false);
  };
  const buildChain = (food: IngredientLite, start: string | null, chosen: IngredientLite[]) => {
    setSteps(
      chainLadderSteps(
        chosen.map((c) => ({ label: c.label, ingredientId: c.id })),
        { label: food.label },
        criteria,
      ).map((s) =>
        s.bridgeFromIngredientId === null && start ? { ...s, bridgeFromIngredientId: start } : s,
      ),
    );
  };
  const suggest = () => {
    if (!target || !startId) return;
    const startFood = safeStarts.find((s) => s.ingredientId === startId);
    const result = suggestChain(
      featuresOf(startId, startFood?.label ?? ''),
      featuresOf(target.id, target.label),
      catalog.data ?? [],
      {
        avoidColors: avoidColours(sensory.data?.colorSensitivities ?? []),
        avoidTextures: new Set(sensory.data?.textureAvoids ?? []),
      },
    );
    setNoChain(result === null);
    const chosen = (result ?? []).map((f) => ({ ...f, nameI18n: {} }));
    setLinks(chosen);
    setSuggested(true);
    buildChain(target, startId, chosen);
  };

  const onSave = () => {
    const targetId = editing ? existing.data?.targetIngredientId : target?.id;
    if (!targetId || steps.length === 0) return;
    save.mutate(
      {
        ladderId: ladderId ?? null,
        familyMemberId,
        targetIngredientId: targetId,
        strategy,
        steps,
        links: links.length,
        suggested,
      },
      {
        onSuccess: (id) =>
          editing
            ? navigation.goBack()
            : navigation.replace('ExposureLadderDetail', { ladderId: id }),
      },
    );
  };

  if (!m.premium)
    return (
      <Screen testID="chain.screen">
        <Text variant="title" accessibilityRole="header">
          {t('editor.newTitle')}
        </Text>
        <UpsellCard
          trigger="exposure_ladder"
          title={t('ladders.upsellTitle')}
          body={t('ladders.upsellBody')}
          testID="chain.upsell"
        />
      </Screen>
    );

  const conflict = isAppError(save.error) && save.error.code === 'CONFLICT';
  return (
    <Screen testID="chain.screen">
      <Text variant="title" accessibilityRole="header">
        {editing
          ? t('editor.editTitle', { food: existing.data?.targetLabel ?? '' })
          : t('editor.newTitle')}
      </Text>
      {parsed ? (
        <InlineMessage tone="info" message={t('editor.fromChat')} testID="chain.from-chat" />
      ) : null}
      {!editing ? (
        <>
          {chainingOn ? (
            <ChipGroup
              label={t('editor.strategy')}
              single
              options={(['exposure_ladder', 'food_chaining'] as const).map((s) => ({
                value: s,
                label: t(`editor.strategies.${s}`),
              }))}
              selected={[strategy]}
              onToggle={(s) => {
                setStrategy(s);
                setSteps([]);
                setLinks([]);
              }}
              testID="chain.strategy"
            />
          ) : null}
          <IngredientPicker
            label={t('editor.target')}
            selected={target}
            onSelect={(f) => {
              setTarget(f);
              if (f && strategy === 'exposure_ladder' && !parsed) buildLadder(f);
              if (!f) setSteps([]);
            }}
            testID="chain.target"
          />
          {parsed && !parsed.targetIngredientId && !target ? (
            <Text tone="muted">{t('editor.pickProposalFood', { food: parsed.targetFood })}</Text>
          ) : null}
          {strategy === 'food_chaining' ? (
            <Card variant="outlined" testID="chain.start">
              {safeStarts.length === 0 ? (
                <Text tone="muted">{t('editor.noSafeFoods')}</Text>
              ) : (
                <ChipGroup
                  label={t('editor.start')}
                  hint={t('editor.startHint')}
                  single
                  options={safeStarts.map((s) => ({
                    value: s.ingredientId as string,
                    label: s.label,
                  }))}
                  selected={startId ? [startId] : []}
                  onToggle={setStartId}
                  testID="chain.start-picker"
                />
              )}
              <Button
                label={t('editor.suggest')}
                variant="secondary"
                onPress={suggest}
                disabled={!target || !startId || catalog.isLoading}
                loading={catalog.isLoading}
                testID="chain.suggest"
              />
              {noChain ? (
                <Text tone="muted" testID="chain.no-chain">
                  {t('editor.noChain')}
                </Text>
              ) : null}
              {links.length > 0 ? (
                <View className="gap-1" testID="chain.links">
                  <Text variant="label" tone="muted">
                    {t('editor.links')}
                  </Text>
                  {links.map((l, i) => (
                    <View key={l.id} className="flex-row items-center justify-between gap-2">
                      <Text>{t('editor.link', { n: i + 1, food: l.label })}</Text>
                      <Button
                        label={t('editor.removeLink')}
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={t('editor.removeLinkA11y', { food: l.label })}
                        onPress={() => {
                          const next = links.filter((x) => x.id !== l.id);
                          setLinks(next);
                          if (target) buildChain(target, startId, next);
                        }}
                        testID="chain.remove-link"
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              {target ? (
                <IngredientPicker
                  label={t('editor.addLink')}
                  selected={null}
                  onSelect={(f) => {
                    if (!f || links.some((x) => x.id === f.id)) return;
                    const next = [...links, f];
                    setLinks(next);
                    buildChain(target, startId, next);
                  }}
                  testID="chain.add-link"
                />
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
      {steps.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('editor.steps', { count: steps.length })}
          </Text>
          <LadderStepsEditor steps={steps} onChange={setSteps} testID="chain.steps" />
        </>
      ) : null}
      {conflict ? (
        <InlineMessage tone="warning" message={t('editor.conflict')} testID="chain.conflict" />
      ) : save.error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(save.error)}`)} />
      ) : null}
      <Text variant="caption" tone="muted">
        {t('editor.note')}
      </Text>
      <Button
        label={t('editor.save')}
        onPress={onSave}
        disabled={!m.canEdit || steps.length === 0 || (!editing && !target)}
        loading={save.isPending}
        fullWidth
        testID="chain.save"
      />
    </Screen>
  );
}
