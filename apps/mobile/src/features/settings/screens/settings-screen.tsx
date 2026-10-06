import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import type { MoreScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

import { useSignOut } from '../hooks/use-sign-out';

/** S1 Settings home (02 §7.13.2), Sprint 1 skeleton: profile and sign out. */
export function SettingsScreen({ navigation }: MoreScreenProps<'Settings'>) {
  const { t } = useTranslation('settings');
  const email = useSessionStore((s) => s.email);
  const { confirm, pending } = useSignOut();

  return (
    <Screen testID="settings.screen">
      <Card>
        <Text variant="overline" tone="muted">
          {t('home.account')}
        </Text>
        {email ? <Text testID="settings.email">{email}</Text> : null}
        <Button
          label={t('home.profile')}
          variant="secondary"
          onPress={() => navigation.navigate('SettingsProfile')}
          testID="settings.profile-button"
        />
      </Card>
      <Button
        label={t('signOut.button')}
        variant="destructive"
        loading={pending}
        onPress={confirm}
        fullWidth
        testID="settings.sign-out-button"
      />
    </Screen>
  );
}
