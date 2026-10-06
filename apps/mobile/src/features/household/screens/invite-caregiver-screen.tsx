import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { z } from 'zod';

import { INVITE_TTL_DAYS, type InvitableRole } from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

import { newIdempotencyKey } from '../api/invite-api';
import { useCreateInvite, useHouseholdPeople } from '../hooks/use-households';

const Email = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

/**
 * X11 Invite Caregiver (02 §7.8.5, §5.12): email + role, then the share link so the owner can
 * also send it over WhatsApp if email is slow. Coach is shown disabled until Phase 2 (00 §11).
 */
export function InviteCaregiverScreen({
  navigation,
  route,
}: RootScreenProps<'InviteCaregiverModal'>) {
  const { t } = useTranslation(['household', 'errors']);
  const { householdId } = route.params;
  const myEmail = useSessionStore((s) => s.email);
  const people = useHouseholdPeople(householdId);
  const create = useCreateInvite(householdId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole | 'coach'>('caregiver');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const submit = () => {
    setFieldError(null);
    const parsed = Email.safeParse(email);
    if (!parsed.success) {
      setFieldError(t('errors:codes.AUTH_INVALID_EMAIL'));
      return;
    }
    const value = parsed.data;
    if (value === myEmail?.toLowerCase()) {
      setFieldError(t('household:invite.notYourself'));
      return;
    }
    if ((people.data ?? []).some((p) => p.email?.toLowerCase() === value)) {
      setFieldError(t('household:invite.alreadyMember'));
      return;
    }
    if (role === 'coach') return;
    create.mutate({ email: value, role, idempotencyKey });
  };

  if (create.data) {
    const url = create.data.share_url;
    return (
      <Screen testID="household-invite.success">
        <Text variant="title" accessibilityRole="header">
          {t('household:invite.sentTitle')}
        </Text>
        <InlineMessage
          tone="success"
          message={t('household:invite.sentBody', { email: email.trim(), days: INVITE_TTL_DAYS })}
        />
        <View className="gap-2">
          <Text variant="label" tone="muted">
            {t('household:invite.linkLabel')}
          </Text>
          <Text selectable testID="household-invite.share-url">
            {url}
          </Text>
          <Text variant="caption" tone="muted">
            {t('household:invite.linkHelper')}
          </Text>
        </View>
        <Button
          label={t('household:invite.share')}
          variant="secondary"
          onPress={() =>
            void Share.share({ message: t('household:invite.shareMessage', { url }) }).catch(
              () => undefined,
            )
          }
          fullWidth
          testID="household-invite.share-button"
        />
        <Button
          label={t('household:invite.inviteAnother')}
          variant="ghost"
          onPress={() => {
            create.reset();
            setEmail('');
            setIdempotencyKey(newIdempotencyKey());
          }}
          fullWidth
        />
        <Button
          label={t('household:common.done')}
          onPress={() => navigation.goBack()}
          fullWidth
          testID="household-invite.done"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="household-invite.screen">
      <View className="gap-2">
        <Text variant="title" accessibilityRole="header">
          {t('household:invite.title')}
        </Text>
        <Text tone="muted">{t('household:invite.body')}</Text>
      </View>
      <Input
        label={t('household:invite.email')}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setFieldError(null);
          if (create.error) create.reset();
          setIdempotencyKey(newIdempotencyKey());
        }}
        {...(fieldError ? { errorText: fieldError } : {})}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        required
        testID="household-invite.email"
      />
      <RadioCardGroup
        label={t('household:invite.role')}
        options={[
          {
            value: 'caregiver',
            title: t('household:roles.caregiver'),
            description: t('household:roleDescriptions.caregiver'),
          },
          {
            value: 'viewer',
            title: t('household:roles.viewer'),
            description: t('household:roleDescriptions.viewer'),
          },
          {
            value: 'coach',
            title: t('household:roles.coach'),
            description: t('household:invite.coachSoon'),
            disabled: true,
          },
        ]}
        value={role}
        onChange={(v) => {
          setRole(v);
          setIdempotencyKey(newIdempotencyKey());
        }}
        testID="household-invite.role"
      />
      {create.error ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(create.error)}`)}
          testID="household-invite.error"
        />
      ) : null}
      <Button
        label={t('household:invite.send')}
        onPress={submit}
        loading={create.isPending}
        fullWidth
        testID="household-invite.send"
      />
      <Button
        label={t('household:common.cancel')}
        variant="ghost"
        onPress={() => navigation.goBack()}
        fullWidth
      />
    </Screen>
  );
}
