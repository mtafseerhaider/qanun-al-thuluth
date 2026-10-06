import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { track } from '@/lib/analytics/track';
import { signOut } from '@/lib/auth/sign-out';

/** Confirmed sign-out (11 §11.1); the purge clears caches, stores and the stored session. */
export function useSignOut() {
  const { t } = useTranslation('settings');
  const [pending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      track('auth_signed_out', { forced: false });
      await signOut();
    } finally {
      setPending(false);
    }
  };

  const confirm = () =>
    Alert.alert(t('signOut.confirmTitle'), t('signOut.confirmBody'), [
      { text: t('signOut.cancel'), style: 'cancel' },
      { text: t('signOut.confirm'), style: 'destructive', onPress: () => void run() },
    ]);

  return { confirm, signOutNow: run, pending };
}
