import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ACTIVITY_LEVELS, type ActivityLevel, type SexAtBirth } from '@shared';

import { LimitReachedNotice } from '@/components/layout/limit-reached-notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import { ChildDataConsentCard, needsChildDataConsent, useConsents } from '@/features/auth';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';

import type { FamilyMember } from '../api/family-members-api';
import { useSaveFamilyMember } from '../hooks/use-family-members';
import {
  dobFromParts,
  emptyMemberForm,
  memberFraming,
  toFormValues,
  validateMemberForm,
  type MemberFormErrors,
  type MemberFormValues,
} from '../utils/member-form';

export interface MemberFormProps {
  householdId: string;
  member?: FamilyMember | null;
  source: 'intake' | 'family';
  /** False when another member of this household is already linked to the signed-in user. */
  allowLinkSelf: boolean;
  onSaved: (id: string) => void;
  onCancel?: () => void;
  testID?: string;
}

/**
 * Add / edit a family member (02 §7.3.2, §7.3.3, §7.8.2). Shows the derived life stage, hides
 * activity for infants and toddlers, frames weight as growth for children (no calorie or
 * weight-loss wording anywhere, 02 §1.1), and asks for child-data consent before the first minor.
 */
export function MemberForm({
  householdId,
  member,
  source,
  allowLinkSelf,
  onSaved,
  onCancel,
  testID = 'member-form',
}: MemberFormProps) {
  const { t } = useTranslation(['family', 'errors']);
  const units = usePreferencesStore((s) => s.units);
  const userId = useSessionStore((s) => s.userId);
  const [values, setValues] = useState<MemberFormValues>(() =>
    member ? toFormValues(member, units, userId) : emptyMemberForm,
  );
  const [errors, setErrors] = useState<MemberFormErrors>({});
  const [newId] = useState(() => Crypto.randomUUID());
  const save = useSaveFamilyMember(householdId, source);
  const consents = useConsents();

  const dob = dobFromParts(values.dobDay, values.dobMonth, values.dobYear);
  const framing = useMemo(() => memberFraming(dob), [dob]);
  const consentNeeded = needsChildDataConsent(
    framing.minor,
    consents.data?.live ?? [],
    householdId,
  );

  const set = <K extends keyof MemberFormValues>(key: K, value: MemberFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    const field = key.startsWith('dob') ? 'dob' : key;
    if (field in errors) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = async () => {
    const result = validateMemberForm(values, { units, linkedUserId: userId });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (consentNeeded) return;
    try {
      const id = await save.mutateAsync({
        ...(member ? { id: member.id } : {}),
        newId,
        input: result.input,
        lifeStage: result.framing.lifeStage ?? 'adult',
      });
      onSaved(id);
    } catch {
      // Rendered from save.error below.
    }
  };

  const err = (field: keyof MemberFormErrors) =>
    errors[field] ? t(`family:form.errors.${errors[field]}`) : undefined;
  const errProps = (field: keyof MemberFormErrors): { errorText?: string } => {
    const text = err(field);
    return text ? { errorText: text } : {};
  };

  const sexOptions = [
    { value: 'female', title: t('family:form.sexFemale') },
    { value: 'male', title: t('family:form.sexMale') },
    { value: 'unspecified', title: t('family:form.sexUnspecified') },
  ] as const satisfies readonly { value: SexAtBirth; title: string }[];

  const activityOptions = ACTIVITY_LEVELS.map((level) => ({
    value: level,
    title: t(`family:activity.${level}.title`),
    description: t(`family:activity.${level}.description`),
  }));

  const saveError = save.error;
  const limitResource =
    isAppError(saveError) && saveError.code === 'LIMIT_REACHED'
      ? String(saveError.details.resource ?? 'family_members')
      : null;
  const dobError = err('dob');
  const heightUnit = units === 'imperial' ? t('family:form.unitIn') : t('family:form.unitCm');
  const weightUnit = units === 'imperial' ? t('family:form.unitLb') : t('family:form.unitKg');

  return (
    <View className="gap-4" testID={testID}>
      <Input
        label={t('family:form.name')}
        helperText={t('family:form.nameHelper')}
        {...errProps('name')}
        value={values.name}
        onChangeText={(v) => set('name', v)}
        autoCapitalize="words"
        maxLength={60}
        required
        testID={`${testID}.name`}
      />

      <View className="gap-2" accessibilityRole="none">
        <Text variant="label" tone="muted">
          {t('family:form.dob')}
        </Text>
        <View className="flex-row gap-2">
          <Input
            className="flex-1"
            label={t('family:form.dobDay')}
            value={values.dobDay}
            onChangeText={(v) => set('dobDay', v.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
            testID={`${testID}.dob-day`}
          />
          <Input
            className="flex-1"
            label={t('family:form.dobMonth')}
            value={values.dobMonth}
            onChangeText={(v) => set('dobMonth', v.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            maxLength={2}
            testID={`${testID}.dob-month`}
          />
          <Input
            className="flex-1"
            label={t('family:form.dobYear')}
            value={values.dobYear}
            onChangeText={(v) => set('dobYear', v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            testID={`${testID}.dob-year`}
          />
        </View>
        {dobError ? (
          <Text variant="caption" tone="danger" testID={`${testID}.dob.error`}>
            {dobError}
          </Text>
        ) : (
          <Text variant="caption" tone="muted">
            {t('family:form.dobHelper')}
          </Text>
        )}
        {framing.lifeStage ? (
          <Text variant="bodyStrong" tone="primary" testID={`${testID}.life-stage`}>
            {t('family:form.lifeStageLabel', {
              stage: t(`family:lifeStage.${framing.lifeStage}`),
            })}
          </Text>
        ) : null}
      </View>

      {framing.minor ? (
        <InlineMessage
          tone="info"
          message={t('family:form.childNote')}
          testID={`${testID}.child-note`}
        />
      ) : null}

      <RadioCardGroup
        label={t('family:form.sex')}
        hint={t('family:form.sexHelper')}
        options={sexOptions}
        value={values.sex}
        onChange={(v) => set('sex', v)}
        inline
        testID={`${testID}.sex`}
      />

      <Input
        label={t('family:form.height')}
        helperText={t('family:form.heightHelper')}
        {...errProps('height')}
        value={values.height}
        onChangeText={(v) => set('height', v)}
        variant="numeric"
        unit={heightUnit}
        testID={`${testID}.height`}
      />
      <Input
        label={t('family:form.weight')}
        helperText={t(`family:form.${framing.weightHelperKey}`)}
        {...errProps('weight')}
        value={values.weight}
        onChangeText={(v) => set('weight', v)}
        variant="numeric"
        unit={weightUnit}
        testID={`${testID}.weight`}
      />

      {framing.showActivity ? (
        <RadioCardGroup<ActivityLevel>
          label={t('family:form.activity')}
          options={activityOptions}
          value={values.activity}
          onChange={(v) => set('activity', v)}
          testID={`${testID}.activity`}
        />
      ) : null}

      {framing.canBeMe && (allowLinkSelf || values.isMe) ? (
        <Checkbox
          label={t('family:form.isMe')}
          description={t('family:form.isMeHelper')}
          checked={values.isMe}
          onChange={(v) => set('isMe', v)}
          testID={`${testID}.is-me`}
        />
      ) : null}

      {consentNeeded ? <ChildDataConsentCard householdId={householdId} /> : null}

      {limitResource ? (
        <LimitReachedNotice resource={limitResource} />
      ) : saveError ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(saveError)}`)}
          testID={`${testID}.error`}
        />
      ) : null}

      <View className="gap-2">
        <Button
          label={member ? t('family:form.saveChanges') : t('family:form.add')}
          onPress={() => void submit()}
          loading={save.isPending}
          disabled={consentNeeded}
          fullWidth
          testID={`${testID}.save`}
        />
        {onCancel ? (
          <Button
            label={t('family:form.cancel')}
            variant="ghost"
            onPress={onCancel}
            fullWidth
            testID={`${testID}.cancel`}
          />
        ) : null}
      </View>
    </View>
  );
}
