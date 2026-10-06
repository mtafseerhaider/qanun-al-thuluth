import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TEXTURES } from '@shared';
import { CUT_SHAPES, TEMPERATURES } from '@shared/domain/intake';
import { FOOD_COLOURS } from '@shared/intake/catalog';
import type { SensoryDraft } from '@shared/intake/questions';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useModuleMember, useSensoryProfile, type SensoryProfileView } from '@/features/exposures';
import { pickTexture, saveSensory, toggle } from '@/features/intake';
import { UpsellCard } from '@/features/subscription';
import { track } from '@/lib/analytics/track';
import { qk } from '@/lib/query/query-keys';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { FamilyScreenProps } from '@/navigation/types';

type Presentation = NonNullable<SensoryDraft['presentation_prefs']>;
const PRESENTATION_FLAGS = [
  'separate_foods',
  'same_plate',
  'divided_plate',
  'sauce_on_side',
  'specific_utensils',
] as const satisfies ReadonlyArray<keyof Presentation>;

export function toDraft(v: SensoryProfileView | null): SensoryDraft {
  if (!v) return { id: Crypto.randomUUID() };
  return {
    id: v.id ?? Crypto.randomUUID(),
    texture_likes: v.textureLikes,
    texture_avoids: v.textureAvoids,
    color_sensitivities: v.colorSensitivities,
    presentation_prefs: v.presentationPrefs as Presentation,
    temperature_prefs: v.temperaturePrefs as SensoryDraft['temperature_prefs'],
    brand_rigidity: v.brandRigidity,
  };
}

/**
 * Sensory profile editor (02 §7.10.2, FR-AUT-02; premium editing). The same fields and the same
 * `SensoryProfileInput` schema as the intake step, so plans and chaining read one profile. Free
 * users see what they entered during intake and an upsell to edit.
 */
export function SensoryProfileScreen({ route }: FamilyScreenProps<'SensoryProfile'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation(['autism', 'intake']);
  const qc = useQueryClient();
  const m = useModuleMember(familyMemberId);
  const profile = useSensoryProfile(m.householdId, familyMemberId);
  const [p, setP] = useState<SensoryDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (profile.data !== undefined && p === null) setP(toDraft(profile.data));
  }, [profile.data, p]);

  const draft = p ?? toDraft(null);
  const pres: Presentation = draft.presentation_prefs ?? {};
  const editable = m.premium && m.canEdit;
  const set = (patch: Partial<SensoryDraft>) => {
    setSaved(false);
    setP({ ...draft, ...patch });
  };
  const colours = (draft.color_sensitivities ?? []).map((c) => c.replace(/^avoid:/, ''));
  const textureOptions = TEXTURES.map((x) => ({
    value: x,
    label: t(`intake:sensory.textures.${x}`),
    disabled: !editable,
  }));

  const save = async () => {
    if (!m.householdId) return;
    setSaving(true);
    setError(null);
    try {
      await saveSensory({ householdId: m.householdId, familyMemberId }, draft);
      track('sensory_profile_updated', {});
      setSaved(true);
      void qc.invalidateQueries({
        queryKey: qk.household(m.householdId).sensoryProfile(familyMemberId),
      });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen testID="sensory.screen">
      <Text variant="title" accessibilityRole="header">
        {t('autism:sensory.title', { name: m.name })}
      </Text>
      <Text tone="muted">{t('intake:sensory.helper', { name: m.name })}</Text>
      {!m.premium ? (
        <UpsellCard
          trigger="sensory_profile"
          title={t('autism:sensory.upsellTitle')}
          body={t('autism:sensory.upsellBody')}
          testID="sensory.upsell"
        />
      ) : null}
      <ChipGroup
        label={t('intake:sensory.likes')}
        options={textureOptions}
        selected={draft.texture_likes ?? []}
        onToggle={(x) => set(pickTexture(draft, 'likes', x))}
        testID="sensory.likes"
      />
      <ChipGroup
        label={t('intake:sensory.avoids')}
        options={textureOptions}
        selected={draft.texture_avoids ?? []}
        onToggle={(x) => set(pickTexture(draft, 'avoids', x))}
        tone="avoid"
        testID="sensory.avoids"
      />
      <ChipGroup
        label={t('intake:sensory.colours')}
        hint={t('intake:sensory.coloursHint')}
        options={FOOD_COLOURS.map((c) => ({
          value: c,
          label: t(`intake:sensory.colourNames.${c}`),
          disabled: !editable,
        }))}
        selected={colours}
        onToggle={(c) => set({ color_sensitivities: toggle(colours, c).map((x) => `avoid:${x}`) })}
        tone="avoid"
        testID="sensory.colours"
      />
      <View className="gap-1" testID="sensory.presentation">
        <Text variant="label" tone="muted">
          {t('intake:sensory.presentation')}
        </Text>
        {PRESENTATION_FLAGS.map((k) => (
          <Checkbox
            key={k}
            label={t(`intake:sensory.presentationFlags.${k}`)}
            checked={pres[k] === true}
            disabled={!editable}
            onChange={(v) => set({ presentation_prefs: { ...pres, [k]: v } })}
            testID={`sensory.presentation.${k}`}
          />
        ))}
      </View>
      <ChipGroup
        label={t('intake:sensory.cutShapes')}
        options={CUT_SHAPES.map((c) => ({
          value: c,
          label: t(`intake:sensory.shapes.${c}`),
          disabled: !editable,
        }))}
        selected={pres.cut_shapes ?? []}
        onToggle={(c) =>
          set({ presentation_prefs: { ...pres, cut_shapes: toggle(pres.cut_shapes ?? [], c) } })
        }
        testID="sensory.cut-shapes"
      />
      <ChipGroup
        label={t('intake:sensory.temperature')}
        options={TEMPERATURES.map((c) => ({
          value: c,
          label: t(`intake:sensory.temperatures.${c}`),
          disabled: !editable,
        }))}
        selected={draft.temperature_prefs ?? []}
        onToggle={(c) => set({ temperature_prefs: toggle(draft.temperature_prefs ?? [], c) })}
        testID="sensory.temperature"
      />
      <Checkbox
        label={t('intake:sensory.brand')}
        checked={draft.brand_rigidity === true}
        disabled={!editable}
        onChange={(brand_rigidity) => set({ brand_rigidity })}
        testID="sensory.brand"
      />
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
      {saved ? (
        <InlineMessage tone="success" message={t('autism:sensory.saved')} testID="sensory.saved" />
      ) : null}
      {editable ? (
        <Button
          label={t('autism:sensory.save')}
          onPress={() => void save()}
          loading={saving}
          fullWidth
          testID="sensory.save"
        />
      ) : null}
    </Screen>
  );
}
