import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { clearParkedInviteToken } from '@/lib/auth/pending-invite';
import { signOut } from '@/lib/auth/sign-out';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';

import { useAcceptInvite } from '../hooks/use-households';
import { acceptOutcomeFor, type AcceptOutcome } from '../utils/invite-utils';

/**
 * X12 Accept Invite (02 §7.8.5, 11 §12.3). Opened automatically once a signed-in user has a parked
 * invite token. Errors follow 11 §12.4; an email mismatch offers to sign out while keeping the token.
 */
export function AcceptInviteScreen({ navigation, route }: RootScreenProps<'AcceptInvite'>) {
  const { t } = useTranslation(['household', 'errors']);
  const { token } = route.params;
  const accept = useAcceptInvite();
  const [outcome, setOutcome] = useState<AcceptOutcome | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const close = () => (navigation.canGoBack() ? navigation.goBack() : undefined);

  const join = () =>
    accept.mutate(token, {
      onSuccess: (res) => {
        setRole(res.role);
        setOutcome('joined');
        void clearParkedInviteToken();
      },
      onError: (e) => {
        const o = acceptOutcomeFor(e);
        setOutcome(o);
        if (o !== 'email_mismatch' && o !== 'error') void clearParkedInviteToken();
      },
    });

  const dismiss = () => {
    void clearParkedInviteToken();
    close();
  };

  if (outcome === 'joined' || outcome === 'already_member') {
    return (
      <Screen testID="household-accept-invite.done">
        <Text variant="title" accessibilityRole="header">
          {t('household:accept.joinedTitle')}
        </Text>
        <InlineMessage
          tone="success"
          message={
            outcome === 'joined' && role
              ? t('household:accept.joinedBody', { role: t(`household:roles.${role}`) })
              : t('household:accept.alreadyMember')
          }
        />
        <Button
          label={t('household:common.continue')}
          onPress={close}
          fullWidth
          testID="household-accept-invite.continue"
        />
      </Screen>
    );
  }

  const errorMessage =
    outcome === 'expired'
      ? t('household:accept.expired')
      : outcome === 'invalid'
        ? t('household:accept.invalid')
        : outcome === 'email_mismatch'
          ? t('household:accept.emailMismatch')
          : outcome === 'error'
            ? t(`errors:${errorKeyFor(accept.error)}`)
            : null;

  return (
    <Screen testID="household-accept-invite.screen">
      <View className="gap-2">
        <Text variant="title" accessibilityRole="header">
          {t('household:accept.title')}
        </Text>
        <Text tone="muted">{t('household:accept.body')}</Text>
      </View>
      {errorMessage ? (
        <InlineMessage
          tone="danger"
          message={errorMessage}
          testID="household-accept-invite.error"
        />
      ) : null}
      {outcome === 'email_mismatch' ? (
        <Button
          label={t('household:accept.signOutAndSwitch')}
          variant="secondary"
          onPress={() => void signOut({ keepPendingInvite: true })}
          fullWidth
          testID="household-accept-invite.switch-account"
        />
      ) : null}
      {outcome === 'expired' || outcome === 'invalid' ? (
        <Button label={t('household:common.done')} onPress={dismiss} fullWidth />
      ) : (
        <>
          <Button
            label={t('household:accept.join')}
            onPress={join}
            loading={accept.isPending}
            fullWidth
            testID="household-accept-invite.join"
          />
          <Button
            label={t('household:accept.notNow')}
            variant="ghost"
            onPress={dismiss}
            fullWidth
            testID="household-accept-invite.dismiss"
          />
        </>
      )}
    </Screen>
  );
}
