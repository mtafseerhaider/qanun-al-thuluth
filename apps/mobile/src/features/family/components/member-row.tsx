import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ageInMonths } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

import type { FamilyMember } from '../api/family-members-api';

/** Age as months under 2 and years after, never weight or calorie numbers (02 §1.1). */
export function ageLabelParts(dob: string | null, today?: string) {
  if (!dob) return null;
  const months = ageInMonths(dob, today);
  return months < 24
    ? ({ unit: 'months', count: months } as const)
    : ({ unit: 'years', count: Math.floor(months / 12) } as const);
}

export function MemberRow({
  member,
  isMe,
  canEdit,
  onEdit,
  onRemove,
  testID,
}: {
  member: FamilyMember;
  isMe: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  testID: string;
}) {
  const { t } = useTranslation('family');
  const age = ageLabelParts(member.date_of_birth);
  const ageText = age
    ? age.unit === 'months'
      ? t('row.ageMonths', { count: age.count })
      : t('row.ageYears', { count: age.count })
    : '';
  const summary = [ageText, t(`lifeStage.${member.life_stage}`), isMe ? t('row.you') : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <Card variant="outlined" padding="sm" testID={testID}>
      <View accessible accessibilityLabel={`${member.name}, ${summary}`} className="gap-1">
        <Text variant="bodyStrong">{member.name}</Text>
        <Text variant="caption" tone="muted">
          {summary}
        </Text>
      </View>
      {canEdit ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={t('row.edit')}
            accessibilityLabel={t('row.editA11y', { name: member.name })}
            size="sm"
            variant="secondary"
            onPress={onEdit}
            testID={`${testID}.edit`}
          />
          <Button
            label={t('row.remove')}
            accessibilityLabel={t('row.removeA11y', { name: member.name })}
            size="sm"
            variant="ghost"
            onPress={onRemove}
            testID={`${testID}.remove`}
          />
        </View>
      ) : null}
    </Card>
  );
}
