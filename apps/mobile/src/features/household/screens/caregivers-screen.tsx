import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { FamilyScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import {
  useChangeHouseholdRole,
  useHouseholdPeople,
  usePendingInvitations,
  useRemoveHouseholdPerson,
  useResendInvite,
  useRevokeInvite,
} from '../hooks/use-households';
import { daysUntil } from '../utils/invite-utils';

/**
 * F4 Caregivers (02 §7.8.5): people with access and their roles, pending invitations, invite,
 * change role, remove access (owner) and leave the household (everyone but the owner, FR-HH-05).
 */
export function CaregiversScreen({ navigation, route }: FamilyScreenProps<'Caregivers'>) {
  const { t } = useTranslation(['household', 'errors']);
  const { householdId } = route.params;
  const userId = useSessionStore((s) => s.userId);
  const activeRole = useActiveHouseholdStore((s) =>
    s.activeHouseholdId === householdId ? s.activeRole : null,
  );
  const isOwner = activeRole === 'owner';
  const people = useHouseholdPeople(householdId);
  const invitations = usePendingInvitations(householdId, isOwner);
  const remove = useRemoveHouseholdPerson(householdId);
  const changeRole = useChangeHouseholdRole(householdId);
  const resend = useResendInvite(householdId);
  const revoke = useRevokeInvite(householdId);
  const error = remove.error ?? changeRole.error ?? resend.error ?? revoke.error ?? people.error;

  const confirmRemove = (person: { id: string; user_id: string; display_name: string }) => {
    const self = person.user_id === userId;
    Alert.alert(
      self ? t('household:people.leaveTitle') : t('household:people.removeTitle'),
      self
        ? t('household:people.leaveBody')
        : t('household:people.removeBody', {
            name: person.display_name || t('household:people.someone'),
          }),
      [
        { text: t('household:common.cancel'), style: 'cancel' },
        {
          text: self ? t('household:people.leave') : t('household:people.remove'),
          style: 'destructive',
          onPress: () =>
            remove.mutate(person, {
              onSuccess: () => {
                if (self) navigation.popToTop();
              },
            }),
        },
      ],
    );
  };

  return (
    <Screen testID="household-caregivers.screen">
      <Text variant="title" accessibilityRole="header">
        {t('household:people.title')}
      </Text>
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
      <View className="gap-2">
        {(people.data ?? []).map((p, i) => {
          const self = p.user_id === userId;
          const name = p.display_name || p.email || t('household:people.someone');
          return (
            <Card
              key={p.id}
              variant="outlined"
              padding="sm"
              testID={`household-caregivers.person-${i}`}
            >
              <View
                accessible
                accessibilityLabel={`${name}, ${t(`household:roles.${p.role}`)}${self ? `, ${t('household:people.you')}` : ''}`}
                className="gap-1"
              >
                <Text variant="bodyStrong">
                  {self ? `${name} · ${t('household:people.you')}` : name}
                </Text>
                <Text variant="caption" tone="muted">
                  {t('household:people.roleLine', {
                    role: t(`household:roles.${p.role}`),
                    description: t(`household:roleDescriptions.${p.role}`),
                  })}
                </Text>
              </View>
              {p.role !== 'owner' && (isOwner || self) ? (
                <View className="flex-row flex-wrap gap-2">
                  {isOwner && (p.role === 'caregiver' || p.role === 'viewer') ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      label={
                        p.role === 'caregiver'
                          ? t('household:people.makeViewer')
                          : t('household:people.makeCaregiver')
                      }
                      loading={changeRole.isPending && changeRole.variables?.id === p.id}
                      onPress={() =>
                        changeRole.mutate({
                          id: p.id,
                          role: p.role === 'caregiver' ? 'viewer' : 'caregiver',
                        })
                      }
                      testID={`household-caregivers.person-${i}.role`}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    label={self ? t('household:people.leave') : t('household:people.remove')}
                    onPress={() => confirmRemove(p)}
                    testID={`household-caregivers.person-${i}.remove`}
                  />
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>

      {isOwner ? (
        <View className="gap-2">
          <Text variant="heading" accessibilityRole="header">
            {t('household:invitations.title')}
          </Text>
          {(invitations.data ?? []).length === 0 ? (
            <Text tone="muted">{t('household:invitations.none')}</Text>
          ) : (
            (invitations.data ?? []).map((inv, i) => (
              <Card
                key={inv.id}
                variant="filled"
                padding="sm"
                testID={`household-caregivers.invite-${i}`}
              >
                <Text variant="bodyStrong">{inv.email}</Text>
                <Text variant="caption" tone="muted">
                  {t('household:invitations.meta', {
                    role: t(`household:roles.${inv.role}`),
                    expiry: t('household:invitations.expiresIn', {
                      count: daysUntil(inv.expires_at),
                    }),
                  })}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    label={t('household:invitations.resend')}
                    loading={resend.isPending && resend.variables === inv.id}
                    onPress={() => resend.mutate(inv.id)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t('household:invitations.revoke')}
                    loading={revoke.isPending && revoke.variables === inv.id}
                    onPress={() => revoke.mutate(inv.id)}
                  />
                </View>
              </Card>
            ))
          )}
          <Button
            label={t('household:invitations.invite')}
            onPress={() => navigation.navigate('InviteCaregiverModal', { householdId })}
            fullWidth
            testID="household-caregivers.invite-button"
          />
        </View>
      ) : null}
    </Screen>
  );
}
