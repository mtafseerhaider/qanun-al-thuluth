import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { formatCountdown } from '@/hooks/use-countdown';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { AuthScreenProps } from '@/navigation/types';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { InviteBanner } from '../components/invite-banner';
import { SocialSignInButtons } from '../components/social-sign-in-buttons';
import { requestEmailOtp, signInReviewer } from '../api/otp-api';
import { useOtpStore } from '../store/use-otp-store';
import { isReviewerEmail, isValidEmail, normalizeEmail } from '../utils/email';
import { canSendCode } from '../utils/otp-flow';

/** B3 Login (02 §7.1.3): email OTP for sign-up and sign-in, Google and Apple, reviewer password. */
export function LoginScreen({ navigation, route }: AuthScreenProps<'Login'>) {
  const { t } = useTranslation(['auth', 'errors']);
  const mode = route.params?.mode ?? 'sign_in';
  const locale = usePreferencesStore((s) => s.locale);
  const markSent = useOtpStore((s) => s.markSent);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const reviewer = isReviewerEmail(email);

  const submit = async () => {
    setFieldError(null);
    setFormError(null);
    if (!isValidEmail(email)) {
      setFieldError(t('errors:codes.AUTH_INVALID_EMAIL'));
      return;
    }
    const normalized = normalizeEmail(email);
    setSubmitting(true);
    try {
      if (reviewer) {
        await signInReviewer(normalized, password);
        return; // AuthProvider routes on SIGNED_IN
      }
      const check = canSendCode(useOtpStore.getState(), normalized, Date.now());
      if (!check.ok) {
        if (check.reason === 'cooldown') {
          navigation.navigate('OtpVerify', { email: normalized });
          return;
        }
        const seconds = Math.ceil((check.retryAt - Date.now()) / 1000);
        setFormError(t('auth:login.tooManySends', { time: formatCountdown(seconds) }));
        return;
      }
      await requestEmailOtp(normalized, locale);
      markSent(normalized);
      track('auth_otp_requested', { mode });
      navigation.navigate('OtpVerify', { email: normalized });
    } catch (e) {
      track('auth_error', {
        code: isAppError(e) ? e.code : 'UNKNOWN',
        step: reviewer ? 'reviewer' : 'login',
      });
      setFormError(t(`errors:${errorKeyFor(e)}`));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen testID="auth-login.screen">
      <InviteBanner />
      <View className="gap-2">
        <Text variant="title" accessibilityRole="header">
          {mode === 'sign_up' ? t('auth:login.titleSignUp') : t('auth:login.titleSignIn')}
        </Text>
        <Text tone="muted">{t('auth:login.body')}</Text>
      </View>
      <View className="gap-4">
        <Input
          label={t('auth:login.emailLabel')}
          {...(reviewer ? {} : { helperText: t('auth:login.emailHelper') })}
          {...(fieldError ? { errorText: fieldError } : {})}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setFieldError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          editable={!submitting}
          testID="auth-login.email-input"
        />
        {reviewer ? (
          <Input
            label={t('auth:login.passwordLabel')}
            helperText={t('auth:login.reviewerHelper')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!submitting}
            testID="auth-login.password-input"
          />
        ) : null}
        {formError ? (
          <InlineMessage tone="danger" message={formError} testID="auth-login.error" />
        ) : null}
        <Button
          label={reviewer ? t('auth:login.signInWithPassword') : t('auth:login.sendCode')}
          onPress={() => void submit()}
          loading={submitting}
          disabled={reviewer && password.length === 0}
          size="lg"
          fullWidth
          testID="auth-login.submit-button"
        />
      </View>
      <SocialSignInButtons />
      <Text variant="caption" tone="muted">
        {t('auth:login.legal')}
      </Text>
    </Screen>
  );
}
