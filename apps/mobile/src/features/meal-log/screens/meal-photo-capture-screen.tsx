import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, View } from 'react-native';

import type { MealType } from '@shared';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { useHouseholdClock } from '@/features/meals';
import { UpsellCard, usePremium } from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { analyzeMeal, preparePhoto, uploadMealPhoto } from '../api/meal-log-api';
import { useMealAnalysisStore } from '../store/use-meal-analysis-store';
import { mealPhotoPath } from '../utils/image-rules';
import { LOGGABLE_MEAL_TYPES, mealTypeForMinutes } from '../utils/meal-log-rules';
import { memberAge } from '../utils/member-age';

type Picked = { uri: string; width: number; height: number };

/**
 * X3 Meal Photo Capture (02 §7.7.3, §5.6, 24 S5-08, FR-TRK-03): camera or library, who ate it,
 * meal type (default by time), an optional note, then Analyze: the photo is resized on the device
 * (1280 px, at most 4 MB, EXIF dropped), uploaded to `meal-photos` and analysed. Premium only:
 * free users see the photo paywall (Q-09). Analysis needs a connection.
 */
export function MealPhotoCaptureScreen({ route, navigation }: RootScreenProps<'MealPhotoCapture'>) {
  const { t } = useTranslation(['mealLog', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const { premium, loading: premiumLoading } = usePremium(householdId);
  const visionOn = useFeatureFlag('ai.vision.enabled');
  const online = useIsOnline();
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const put = useMealAnalysisStore((s) => s.put);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [memberId, setMemberId] = useState<string | null>(route.params.familyMemberId ?? null);
  const [mealType, setMealType] = useState<MealType>(() => mealTypeForMinutes(clock.nowMinutes));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cameraDenied, setCameraDenied] = useState(false);

  const list = members.data ?? [];
  const member = list.find((m) => m.id === memberId) ?? list[0] ?? null;

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setCameraDenied(true);
        return;
      }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
      allowsEditing: false,
    };
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset) return;
    setPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
    track('meal_photo_captured', { source });
  };

  const analyze = async () => {
    if (!photo || !member || !householdId) return;
    setBusy(true);
    setError(null);
    try {
      const mealLogId = Crypto.randomUUID();
      const now = new Date();
      const prepared = await preparePhoto(photo);
      const path = mealPhotoPath(householdId, member.id, mealLogId, now);
      await uploadMealPhoto(path, prepared.uri);
      const result = await analyzeMeal({
        household_id: householdId,
        family_member_id: member.id,
        photo_path: path,
        ...(note.trim() ? { text: note.trim().slice(0, 500) } : {}),
        meal_type: mealType,
        eaten_at: now.toISOString(),
        save: false,
      });
      const age = memberAge(member, clock.today);
      put({
        analysisId: result.analysis_id,
        mealLogId,
        householdId,
        memberId: member.id,
        minor: age.minor || !result.show_numbers,
        mealType,
        eatenAt: now.toISOString(),
        note: note.trim(),
        photoUri: prepared.uri,
        photoPath: path,
        result,
        sessionId: route.params.sessionId ?? null,
      });
      track('meal_photo_analyzed', {
        confidence_bucket:
          result.overall_confidence < 0.5
            ? 'low'
            : result.overall_confidence < 0.75
              ? 'medium'
              : 'high',
        minor: age.minor,
      });
      navigation.replace('MealAnalysisResult', {
        analysisId: result.analysis_id,
        ...(route.params.sessionId ? { sessionId: route.params.sessionId } : {}),
      });
    } catch (e) {
      if (isAppError(e) && e.code === 'PREMIUM_REQUIRED') {
        navigation.replace('PaywallModal', { trigger: 'photo' });
        return;
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!premiumLoading && !premium)
    return (
      <Screen testID="meal-photo.screen">
        <UpsellCard
          trigger="photo"
          title={t('mealLog:upsell.title')}
          body={t('mealLog:upsell.body')}
          testID="meal-photo.upsell"
        />
      </Screen>
    );

  return (
    <Screen testID="meal-photo.screen">
      <Text variant="title" accessibilityRole="header">
        {t('mealLog:capture.title')}
      </Text>
      <Text tone="muted">{t('mealLog:capture.frameHint')}</Text>

      {!visionOn ? <InlineMessage tone="info" message={t('mealLog:capture.disabled')} /> : null}
      {!online ? (
        <InlineMessage
          tone="info"
          message={t('mealLog:capture.offline')}
          testID="meal-photo.offline"
        />
      ) : null}
      {!canEdit ? <InlineMessage tone="info" message={t('mealLog:capture.viewer')} /> : null}

      {photo ? (
        <Image
          source={{ uri: photo.uri }}
          accessibilityIgnoresInvertColors
          accessibilityLabel={t('mealLog:capture.previewA11y')}
          className="h-64 w-full rounded-lg"
          resizeMode="cover"
          resizeMethod="resize"
          testID="meal-photo.preview"
        />
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        <Button
          label={photo ? t('mealLog:capture.retake') : t('mealLog:capture.camera')}
          onPress={() => void pick('camera')}
          disabled={busy || !canEdit}
          testID="meal-photo.camera"
        />
        <Button
          label={t('mealLog:capture.library')}
          variant="secondary"
          onPress={() => void pick('library')}
          disabled={busy || !canEdit}
          testID="meal-photo.library"
        />
      </View>

      {cameraDenied ? (
        <View className="gap-2" testID="meal-photo.camera-denied">
          <InlineMessage tone="warning" message={t('mealLog:capture.cameraDenied')} />
          <Button
            label={t('mealLog:capture.openSettings')}
            variant="link"
            size="sm"
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : null}

      {photo ? (
        <>
          <ChipGroup
            label={t('mealLog:capture.who')}
            single
            options={list.map((m) => ({ value: m.id, label: m.name }))}
            selected={member ? [member.id] : []}
            onToggle={setMemberId}
            testID="meal-photo.member"
          />
          <ChipGroup
            label={t('mealLog:capture.mealType')}
            single
            options={LOGGABLE_MEAL_TYPES.map((v) => ({
              value: v,
              label: t(`mealLog:mealTypes.${v}`),
            }))}
            selected={[mealType]}
            onToggle={setMealType}
            testID="meal-photo.meal-type"
          />
          <Input
            label={t('mealLog:capture.note')}
            value={note}
            onChangeText={(v) => setNote(v.slice(0, 500))}
            variant="multiline"
            helperText={t('mealLog:capture.noteHint')}
            testID="meal-photo.note"
          />
          {error ? (
            <InlineMessage
              tone="danger"
              message={t(`errors:${errorKeyFor(error)}`)}
              testID="meal-photo.error"
            />
          ) : null}
          <Button
            label={busy ? t('mealLog:capture.analyzing') : t('mealLog:capture.analyze')}
            fullWidth
            loading={busy}
            disabled={!online || !member || !canEdit || !visionOn}
            onPress={() => void analyze()}
            testID="meal-photo.analyze"
          />
        </>
      ) : null}
    </Screen>
  );
}
