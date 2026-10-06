import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { formatCountdown, useCountdown } from '@/hooks/use-countdown';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { AuthScreenProps } from '@/navigation/types';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useThemeColors } from '@/theme/use-theme-colors';

import { requestEmailOtp, verifyEmailOtp } from '../api/otp-api';
import { OtpCodeInput, type OtpCodeInputHandle } from '../components/otp-code-input';
import { InviteBanner } from '../components/invite-banner';
import { useOtpStore } from '../store/use-otp-store';
import { attemptsLeft, canSendCode, maskEmail } from '../utils/otp-flow';

/**
 * B4 OTP verification (02 §7.1.4, 11 §3): auto-submit on the sixth digit, paste and one-time-code
 * autofill, 60 s resend countdown, five wrong codes lock the input until a resend.
 */
export function OtpVerifyScreen({ navigation, route }: AuthScreenProps<'OtpVerify'>) {
  const { t } = useTranslation(['auth', 'errors']);
  const colors = useThemeColors();
  const { email } = route.params;
  const locale = usePreferencesStore((s) => s.locale);
  const status = useOtpStore((s) => s.status);
  const resendAt = useOtpStore((s) => s.resendAvailableAt);
  const inputRef = useRef<OtpCodeInputHandle>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const remaining = useCountdown(resendAt);
  const locked = status === 'locked';

  const verify = async (value: string) => {
    if (verifying || locked) return;
    setVerifying(true);
    setMessage(null);
    try {
      await verifyEmailOtp(email, value);
      track('auth_otp_verified', {
        attempts: useOtpStore.getState().wrongAttempts + 1,
      });
      // The session change re-routes through AuthProvider; nothing else to do here.
    } catch (e) {
      const code = isAppError(e) ? e.code : 'UNKNOWN';
      track('auth_error', { code, step: 'otp' });
      const store = useOtpStore.getState();
      if (code === 'AUTH_OTP_INVALID') {
        store.markWrongCode();
        const next = useOtpStore.getState();
        setMessage({
          tone: 'danger',
          text:
            next.status === 'locked'
              ? t('auth:otp.locked')
              : t('auth:otp.wrongCode', { count: attemptsLeft(next) }),
        });
      } else if (code === 'AUTH_OTP_EXPIRED') {
        store.markExpired();
        setMessage({ tone: 'danger', text: t('auth:otp.expired') });
      } else {
        setMessage({ tone: 'danger', text: t(`errors:${errorKeyFor(e)}`) });
      }
      inputRef.current?.clear();
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    const check = canSendCode(useOtpStore.getState(), email, Date.now());
    if (!check.ok && check.reason === 'window') {
      const seconds = Math.ceil((check.retryAt - Date.now()) / 1000);
      setMessage({
        tone: 'danger',
        text: t('auth:login.tooManySends', { time: formatCountdown(seconds) }),
      });
      return;
    }
    setResending(true);
    setMessage(null);
    try {
      await requestEmailOtp(email, locale);
      useOtpStore.getState().markSent(email);
      track('auth_otp_resent', {});
      setCode('');
      setMessage({ tone: 'success', text: t('auth:otp.resent') });
      inputRef.current?.focus();
    } catch (e) {
      setMessage({ tone: 'danger', text: t(`errors:${errorKeyFor(e)}`) });
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen testID="auth-otp-verify.screen">
      <InviteBanner />
      <View className="gap-2">
        <Text variant="title" accessibilityRole="header">
          {t('auth:otp.heading')}
        </Text>
        <Text tone="muted">{t('auth:otp.body', { email: maskEmail(email) })}</Text>
        <Button
          label={t('auth:otp.changeEmail')}
          variant="link"
          size="sm"
          className="self-start px-0"
          onPress={() => navigation.goBack()}
          testID="auth-otp-verify.change-email"
        />
      </View>
      <OtpCodeInput
        ref={inputRef}
        value={code}
        onChange={setCode}
        onComplete={(c) => void verify(c)}
        label={t('auth:otp.inputLabel', { count: 6 })}
        disabled={verifying || locked}
        invalid={message?.tone === 'danger'}
        autoFocus
        testID="auth-otp-verify.code-input"
      />
      {verifying ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('auth:otp.verifying')} />
      ) : null}
      {message ? (
        <InlineMessage
          tone={message.tone}
          message={message.text}
          testID="auth-otp-verify.message"
        />
      ) : null}
      <View className="gap-2">
        {remaining > 0 ? (
          <Text tone="muted" testID="auth-otp-verify.countdown">
            {t('auth:otp.resendIn', { time: formatCountdown(remaining) })}
          </Text>
        ) : (
          <Button
            label={t('auth:otp.resend')}
            variant="secondary"
            loading={resending}
            onPress={() => void resend()}
            testID="auth-otp-verify.resend-button"
          />
        )}
        <Text variant="caption" tone="muted">
          {t('auth:otp.help')}
        </Text>
      </View>
    </Screen>
  );
}
