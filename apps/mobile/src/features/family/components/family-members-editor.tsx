import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { FREE_LIMITS } from '@shared';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { useSessionStore } from '@/stores/use-session-store';

import { useFamilyMembers, useRemoveFamilyMember } from '../hooks/use-family-members';
import { MemberForm } from './member-form';
import { MemberRow } from './member-row';

/**
 * Roster with inline add / edit / remove (02 §7.3.2 I2, §7.8.1 F1). Used by onboarding step 4 and
 * the Family tab. The counter shows the free-plan limit; the server trigger is the enforcement.
 */
export function FamilyMembersEditor({
  householdId,
  source,
  canEdit,
  testID = 'family-members',
}: {
  householdId: string;
  source: 'intake' | 'family';
  canEdit: boolean;
  testID?: string;
}) {
  const { t } = useTranslation(['family', 'errors', 'common']);
  const userId = useSessionStore((s) => s.userId);
  const members = useFamilyMembers(householdId);
  const remove = useRemoveFamilyMember(householdId);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const list = members.data ?? [];
  const linkedToMe = list.find((m) => userId !== null && m.linked_user_id === userId);
  const editingMember = editing && editing !== 'new' ? list.find((m) => m.id === editing) : null;

  const confirmRemove = (id: string, name: string) =>
    Alert.alert(t('family:remove.title', { name }), t('family:remove.body'), [
      { text: t('family:form.cancel'), style: 'cancel' },
      {
        text: t('family:remove.confirm'),
        style: 'destructive',
        onPress: () => remove.mutate(id),
      },
    ]);

  return (
    <View className="gap-3" testID={testID}>
      <Text variant="caption" tone="muted" testID={`${testID}.count`}>
        {t('family:list.count', { count: list.length, max: FREE_LIMITS.membersPerHousehold })}
      </Text>
      {members.isError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(members.error)}`)} />
      ) : null}
      {list.length === 0 && !members.isLoading && editing === null ? (
        <Text tone="muted" testID={`${testID}.empty`}>
          {t('family:list.empty')}
        </Text>
      ) : null}
      {list.map((m, i) =>
        editing === m.id && editingMember ? (
          <MemberForm
            key={m.id}
            householdId={householdId}
            member={editingMember}
            source={source}
            allowLinkSelf={!linkedToMe || linkedToMe.id === m.id}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            testID={`${testID}.form`}
          />
        ) : (
          <MemberRow
            key={m.id}
            member={m}
            isMe={userId !== null && m.linked_user_id === userId}
            canEdit={canEdit && editing === null}
            onEdit={() => setEditing(m.id)}
            onRemove={() => confirmRemove(m.id, m.name)}
            testID={`${testID}.row-${i}`}
          />
        ),
      )}
      {remove.error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(remove.error)}`)} />
      ) : null}
      {editing === 'new' ? (
        <MemberForm
          householdId={householdId}
          source={source}
          allowLinkSelf={!linkedToMe}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
          testID={`${testID}.form`}
        />
      ) : canEdit && editing === null ? (
        <Button
          label={t('family:list.add')}
          variant="secondary"
          onPress={() => setEditing('new')}
          fullWidth
          testID={`${testID}.add`}
        />
      ) : null}
    </View>
  );
}
