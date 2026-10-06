import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SEVERITIES, type Severity } from '@shared';
import type { AllergyDraft, ListAnswer } from '@shared/intake/questions';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveAllergies, type Allergen } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useAllergens } from '../hooks/use-allergens';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberAllergies'>;

/** Allergies whose severity has not been chosen yet (required for `kind = 'allergy'`, 02 §7.3.6). */
export function allergiesMissingSeverity(items: readonly AllergyDraft[]): string[] {
  return items.filter((a) => !a.severity).map((a) => a.id);
}

export function allergenName(a: Allergen, locale: string): string {
  return a.name_i18n[locale] ?? a.name_i18n.en ?? a.code;
}

/**
 * I6 Allergies and intolerances (02 §7.3.6, 24 S2-05): picker over the seeded `allergens` table
 * (EU-14 + US Big-9), allergy or intolerance, severity including anaphylactic, and notes.
 */
export function IntakeAllergiesScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t, i18n } = useTranslation('intake');
  const s = useMemberStep('allergies', familyMemberId);
  const allergens = useAllergens();
  const [query, setQuery] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const name = s.member?.name ?? '';
  const list: ListAnswer<AllergyDraft> = s.answers.allergies ?? { none: false, items: [] };
  const byId = new Map((allergens.data ?? []).map((a) => [a.id, a]));
  const set = (items: AllergyDraft[]) => s.update({ allergies: { none: false, items } });

  const toggle = (a: Allergen) => {
    const existing = list.items.find((x) => x.allergen_id === a.id);
    if (existing) set(list.items.filter((x) => x !== existing));
    // Severity is chosen explicitly; the draft holds it unset until then.
    else
      set([...list.items, { id: newRowId(), allergen_id: a.id, kind: 'allergy' } as AllergyDraft]);
  };
  const patch = (id: string, p: Partial<AllergyDraft>) =>
    set(list.items.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const q = query.trim().toLowerCase();
  const shown = (allergens.data ?? []).filter(
    (a) => !q || allergenName(a, i18n.language).toLowerCase().includes(q) || a.code.includes(q),
  );
  const missing = list.none ? [] : allergiesMissingSeverity(list.items);

  const onNext = () => {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    void s.next(() =>
      saveAllergies(
        { householdId: s.householdId as string, familyMemberId },
        list.none ? [] : list.items,
      ),
    );
  };

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('allergies.title', { name })}
      subtitle={t('allergies.helper')}
      onNext={onNext}
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-allergies.screen"
    >
      <Checkbox
        label={t('allergies.none')}
        checked={list.none}
        onChange={(none) => s.update({ allergies: { none, items: none ? [] : list.items } })}
        testID="intake-allergies.none"
      />
      {!list.none ? (
        <View className="gap-3">
          <Input
            label={t('allergies.search')}
            value={query}
            onChangeText={setQuery}
            variant="search"
            autoCorrect={false}
            testID="intake-allergies.search"
          />
          {allergens.isLoading ? (
            <Text tone="muted" testID="intake-allergies.loading">
              {t('common.loading')}
            </Text>
          ) : allergens.isError ? (
            <View className="gap-2" testID="intake-allergies.load-error">
              <InlineMessage tone="danger" message={t('allergies.loadError')} />
              <Button
                label={t('common.retry')}
                variant="secondary"
                size="sm"
                className="self-start"
                onPress={() => void allergens.refetch()}
                testID="intake-allergies.retry"
              />
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2" testID="intake-allergies.grid">
              {shown.map((a) => (
                <Chip
                  key={a.id}
                  label={allergenName(a, i18n.language)}
                  selected={list.items.some((x) => x.allergen_id === a.id)}
                  onPress={() => toggle(a)}
                  testID={`intake-allergies.allergen.${a.code}`}
                />
              ))}
            </View>
          )}
          {list.items.map((item) => {
            const allergen = byId.get(item.allergen_id);
            const label = allergen ? allergenName(allergen, i18n.language) : '';
            const missingSeverity = showMissing && !item.severity;
            return (
              <Card
                key={item.id}
                variant="outlined"
                testID={`intake-allergies.item.${allergen?.code ?? item.id}`}
              >
                <Text variant="bodyStrong">{label}</Text>
                <RadioCardGroup
                  label={t('allergies.kind')}
                  options={[
                    { value: 'allergy', title: t('allergies.kinds.allergy') },
                    { value: 'intolerance', title: t('allergies.kinds.intolerance') },
                  ]}
                  value={item.kind ?? 'allergy'}
                  onChange={(kind) =>
                    patch(item.id, {
                      kind,
                      ...(kind === 'intolerance' && !item.severity
                        ? { severity: 'mild' as const }
                        : {}),
                    })
                  }
                  inline
                  testID={`intake-allergies.item.${allergen?.code ?? item.id}.kind`}
                />
                <RadioCardGroup<Severity>
                  label={t('allergies.severity')}
                  options={SEVERITIES.map((sev) => ({
                    value: sev,
                    title: t(`allergies.severities.${sev}`),
                  }))}
                  value={item.severity ?? null}
                  onChange={(severity) => patch(item.id, { severity })}
                  testID={`intake-allergies.item.${allergen?.code ?? item.id}.severity`}
                />
                {missingSeverity ? (
                  <Text variant="caption" tone="danger">
                    {t('allergies.severityRequired')}
                  </Text>
                ) : null}
                {item.severity === 'anaphylactic' ? (
                  <InlineMessage
                    tone="warning"
                    message={t('allergies.anaphylactic', { allergen: label, name })}
                    testID={`intake-allergies.item.${allergen?.code ?? item.id}.anaphylactic`}
                  />
                ) : null}
                <Input
                  label={t('allergies.notes')}
                  value={item.reaction_notes ?? ''}
                  onChangeText={(text) => patch(item.id, { reaction_notes: text || null })}
                  variant="multiline"
                  maxLength={280}
                />
              </Card>
            );
          })}
        </View>
      ) : null}
    </IntakeStepScaffold>
  );
}
