import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CUT_SHAPES, TEMPERATURES } from '@shared/domain/intake';
import { FOOD_COLOURS } from '@shared/intake/catalog';
import type { SensoryDraft } from '@shared/intake/questions';
import { TEXTURES, type Texture } from '@shared';

import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveSensory } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId, toggle } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeModuleSensory'>;
type Presentation = NonNullable<SensoryDraft['presentation_prefs']>;
const PRESENTATION_FLAGS = [
  'separate_foods',
  'same_plate',
  'divided_plate',
  'sauce_on_side',
  'specific_utensils',
] as const satisfies ReadonlyArray<keyof Presentation>;

/** Selecting a texture on one side removes it from the other (08 §5.9). */
export function pickTexture(
  p: Pick<SensoryDraft, 'texture_likes' | 'texture_avoids'>,
  side: 'likes' | 'avoids',
  texture: Texture,
): { texture_likes: Texture[]; texture_avoids: Texture[] } {
  const likes = p.texture_likes ?? [];
  const avoids = p.texture_avoids ?? [];
  if (side === 'likes')
    return {
      texture_likes: toggle(likes, texture),
      texture_avoids: avoids.filter((x) => x !== texture),
    };
  return {
    texture_avoids: toggle(avoids, texture),
    texture_likes: likes.filter((x) => x !== texture),
  };
}

/** I11 Sensory profile for the autism module (02 §7.3.11, 15 §3.2, 24 S2-06). */
export function IntakeSensoryScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('sensory', familyMemberId);
  const name = s.member?.name ?? '';
  const p: SensoryDraft = s.answers.sensory ?? { id: newRowId() };
  const pres: Presentation = p.presentation_prefs ?? {};
  const set = (patch: Partial<SensoryDraft>) => s.update({ sensory: { ...p, ...patch } });
  const colours = (p.color_sensitivities ?? []).map((c) => c.replace(/^avoid:/, ''));
  const textureOptions = TEXTURES.map((x) => ({ value: x, label: t(`sensory.textures.${x}`) }));

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('sensory.title', { name })}
      subtitle={t('sensory.helper', { name })}
      onNext={() =>
        void s.next(() => saveSensory({ householdId: s.householdId as string, familyMemberId }, p))
      }
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-sensory.screen"
    >
      <RadioCardGroup
        label={t('sensory.diagnosis')}
        options={(['diagnosed', 'assessment_pending', 'suspected'] as const).map((d) => ({
          value: d,
          title: t(`sensory.diagnoses.${d}`),
        }))}
        value={s.answers.autism?.diagnosis ?? null}
        onChange={(diagnosis) => s.update({ autism: { diagnosis } })}
        testID="intake-sensory.diagnosis"
      />
      <ChipGroup
        label={t('sensory.likes')}
        options={textureOptions}
        selected={p.texture_likes ?? []}
        onToggle={(x) => set(pickTexture(p, 'likes', x))}
        testID="intake-sensory.likes"
      />
      <ChipGroup
        label={t('sensory.avoids')}
        options={textureOptions}
        selected={p.texture_avoids ?? []}
        onToggle={(x) => set(pickTexture(p, 'avoids', x))}
        tone="avoid"
        testID="intake-sensory.avoids"
      />
      <ChipGroup
        label={t('sensory.colours')}
        hint={t('sensory.coloursHint')}
        options={FOOD_COLOURS.map((c) => ({ value: c, label: t(`sensory.colourNames.${c}`) }))}
        selected={colours}
        onToggle={(c) => set({ color_sensitivities: toggle(colours, c).map((x) => `avoid:${x}`) })}
        tone="avoid"
        testID="intake-sensory.colours"
      />
      <View className="gap-1" testID="intake-sensory.presentation">
        <Text variant="label" tone="muted">
          {t('sensory.presentation')}
        </Text>
        {PRESENTATION_FLAGS.map((k) => (
          <Checkbox
            key={k}
            label={t(`sensory.presentationFlags.${k}`)}
            checked={pres[k] === true}
            onChange={(v) => set({ presentation_prefs: { ...pres, [k]: v } })}
            testID={`intake-sensory.presentation.${k}`}
          />
        ))}
      </View>
      <ChipGroup
        label={t('sensory.cutShapes')}
        options={CUT_SHAPES.map((c) => ({ value: c, label: t(`sensory.shapes.${c}`) }))}
        selected={pres.cut_shapes ?? []}
        onToggle={(c) =>
          set({ presentation_prefs: { ...pres, cut_shapes: toggle(pres.cut_shapes ?? [], c) } })
        }
        testID="intake-sensory.cut-shapes"
      />
      <ChipGroup
        label={t('sensory.temperature')}
        options={TEMPERATURES.map((c) => ({ value: c, label: t(`sensory.temperatures.${c}`) }))}
        selected={p.temperature_prefs ?? []}
        onToggle={(c) => set({ temperature_prefs: toggle(p.temperature_prefs ?? [], c) })}
        testID="intake-sensory.temperature"
      />
      <Checkbox
        label={t('sensory.brand')}
        checked={p.brand_rigidity === true}
        onChange={(brand_rigidity) => set({ brand_rigidity })}
        testID="intake-sensory.brand"
      />
    </IntakeStepScaffold>
  );
}
