import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { env } from '@/lib/env';
import { useOutboxStore } from '@/lib/offline/outbox';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import {
  SUPPORT_EMAIL,
  diagnosticsText,
  supportMailto,
  type Diagnostics,
} from '../utils/diagnostics';

async function hashUserId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId);
    return digest.slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * Contact support (S6-12). The user writes a message; technical details are shown in full and are
 * only attached when the user ticks the box. The message opens in the user's own mail app, so
 * nothing is sent without them pressing Send there.
 */
export function ContactSupportScreen() {
  const { t, i18n } = useTranslation('help');
  const userId = useSessionStore((s) => s.userId);
  const role = useActiveHouseholdStore((s) => s.activeRole);
  const pending = useOutboxStore((s) => s.entries.length);
  const failed = useOutboxStore((s) => s.failed.length);
  const [userRef, setUserRef] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [include, setInclude] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    void hashUserId(userId).then(setUserRef);
  }, [userId]);

  const diagnostics: Diagnostics = {
    appVersion: env.APP_VERSION,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    locale: i18n.language,
    role: role ?? null,
    userRef,
    pendingSync: pending,
    failedSync: failed,
  };
  const text = diagnosticsText(diagnostics);

  const send = async () => {
    setError(false);
    track('support_contact_opened', { diagnostics: include });
    const url = supportMailto(t('contact.subject'), message.trim(), include ? text : null);
    try {
      await Linking.openURL(url);
    } catch {
      setError(true);
    }
  };

  return (
    <Screen testID="contact.screen">
      <Text variant="title" accessibilityRole="header">
        {t('contact.title')}
      </Text>
      <Text tone="muted">{t('contact.intro')}</Text>
      <Input
        label={t('contact.message')}
        helperText={t('contact.messageHint')}
        value={message}
        onChangeText={setMessage}
        variant="multiline"
        maxLength={4000}
        testID="contact.message"
      />
      <Card variant="filled" testID="contact.diagnostics">
        <Checkbox
          label={t('contact.include')}
          checked={include}
          onChange={setInclude}
          testID="contact.include"
        />
        <Text variant="caption" tone="muted">
          {t('contact.includeHint')}
        </Text>
        <Text variant="caption" selectable testID="contact.diagnostics.text">
          {text}
        </Text>
      </Card>
      {error ? (
        <InlineMessage
          tone="info"
          message={t('contact.noMail', { email: SUPPORT_EMAIL })}
          testID="contact.no-mail"
        />
      ) : null}
      <Button
        label={t('contact.send')}
        onPress={() => void send()}
        disabled={message.trim().length < 5}
        fullWidth
        testID="contact.send"
      />
      <Text variant="caption" tone="muted">
        {t('contact.emergency')}
      </Text>
    </Screen>
  );
}
