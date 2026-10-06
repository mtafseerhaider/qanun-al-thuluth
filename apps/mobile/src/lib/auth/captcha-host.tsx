import { Hcaptcha } from '@hcaptcha/react-native-hcaptcha';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { env } from '@/lib/env';
import { AppError } from '@/lib/supabase/app-error';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useResolvedScheme, useThemeColors } from '@/theme/use-theme-colors';

import { setCaptchaTokenProvider } from './captcha';

interface Pending {
  resolve: (token: string) => void;
  reject: (error: AppError) => void;
}

/** Shape of the package's onMessage event (success, reset and markUsed are added by the widget). */
export interface CaptchaMessage {
  nativeEvent: { data: string };
  success?: boolean;
  reset?: () => void;
  markUsed?: () => void;
}

const failed = (reason: string) =>
  new AppError('AUTH_CAPTCHA_FAILED', `hCaptcha did not return a token (${reason}).`, {
    details: { reason },
  });

/**
 * Shows the hCaptcha challenge in a dismissible modal when a protected auth call asks for a token
 * (lib/auth/captcha.ts). Renders nothing and registers nothing when no site key is configured.
 * Back button, the Cancel button and closing the challenge all reject with AUTH_CAPTCHA_FAILED, which
 * the calling screen shows as localized copy.
 */
export function CaptchaHost({ siteKey = env.HCAPTCHA_SITE_KEY }: { siteKey?: string }) {
  const { t } = useTranslation('auth');
  const locale = usePreferencesStore((s) => s.locale);
  const scheme = useResolvedScheme();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const pending = useRef<Pending | null>(null);
  const [visible, setVisible] = useState(false);

  const settle = useCallback((outcome: { token: string } | { error: AppError }) => {
    const current = pending.current;
    pending.current = null;
    setVisible(false);
    if (!current) return;
    if ('token' in outcome) current.resolve(outcome.token);
    else current.reject(outcome.error);
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    const unregister = setCaptchaTokenProvider(
      () =>
        new Promise<string>((resolve, reject) => {
          pending.current?.reject(failed('superseded'));
          pending.current = { resolve, reject };
          setVisible(true);
        }),
    );
    return () => {
      unregister();
      pending.current?.reject(failed('unmounted'));
      pending.current = null;
    };
  }, [siteKey]);

  const onMessage = (event: CaptchaMessage) => {
    const data = event.nativeEvent.data;
    if (data === 'open') return; // the visual challenge is now showing
    if (data === 'challenge-expired') {
      event.reset?.();
      return;
    }
    if (event.success && data) {
      event.markUsed?.();
      settle({ token: data });
      return;
    }
    settle({ error: failed(data || 'error') });
  };

  if (!siteKey) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={() => settle({ error: failed('cancel') })}
      testID="captcha.modal"
    >
      <View
        className="flex-1 bg-surface"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        accessibilityViewIsModal
      >
        <View className="flex-row items-center justify-between gap-3 px-4 py-2">
          <Text variant="heading" accessibilityRole="header" className="flex-1">
            {t('captcha.title')}
          </Text>
          <Button
            label={t('captcha.cancel')}
            variant="ghost"
            size="sm"
            onPress={() => settle({ error: failed('cancel') })}
            testID="captcha.cancel"
          />
        </View>
        <Text tone="muted" className="px-4">
          {t('captcha.body')}
        </Text>
        {visible ? (
          <View className="flex-1">
            <Hcaptcha
              siteKey={siteKey}
              size="invisible"
              languageCode={locale}
              theme={scheme}
              backgroundColor={colors.surface}
              showLoading
              closableLoading
              loadingIndicatorColor={colors.primary}
              onMessage={onMessage}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
