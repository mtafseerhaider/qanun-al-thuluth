import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { useReauth } from '../hooks/use-privacy';

/**
 * Step-up re-auth (11 §15.1): a 6-digit code to the account email. `onVerified` runs right after
 * the code is accepted, inside the 5-minute window the server checks.
 */
export function ReauthPanel({
  actionLabel,
  onVerified,
  busy,
  destructive = false,
  testID = 'reauth',
}: {
  actionLabel: string;
  destructive?: boolean;
  onVerified: () => void;
  busy: boolean;
  testID?: string;
}) {
  const { t } = useTranslation('privacy');
  const { email, send, verify } = useReauth();
  const [code, setCode] = useState('');
  const sent = send.isSuccess;
  const error = verify.error ?? send.error;

  return (
    <Card variant="outlined" testID={testID}>
      <Text variant="bodyStrong">{t('reauth.title')}</Text>
      <Text tone="muted">{t('reauth.body', { email: email ?? '' })}</Text>
      {!sent ? (
        <Button
          label={t('reauth.send')}
          onPress={() => send.mutate()}
          loading={send.isPending}
          disabled={!email}
          testID={`${testID}.send`}
        />
      ) : (
        <>
          <Input
            label={t('reauth.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            variant="numeric"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            testID={`${testID}.code`}
          />
          <Button
            label={actionLabel}
            variant={destructive ? 'destructive' : 'primary'}
            onPress={() => verify.mutate(code, { onSuccess: onVerified })}
            loading={verify.isPending || busy}
            disabled={code.length !== 6}
            testID={`${testID}.confirm`}
          />
          <Button
            label={t('reauth.resend')}
            variant="ghost"
            size="sm"
            onPress={() => send.mutate()}
            testID={`${testID}.resend`}
          />
        </>
      )}
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
    </Card>
  );
}
