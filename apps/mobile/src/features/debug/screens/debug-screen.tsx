import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { analytics, flushAnalytics, setAnalyticsContext, track } from '@/lib/analytics/track';
import { env, isSupabaseConfigured } from '@/lib/env';
import { captureException, isSentryEnabled } from '@/lib/sentry/init';
import { getCurrentUserId } from '@/lib/supabase/client';
import { DEV_SEED_HOUSEHOLD_ID, signInAsDevSeedUser } from '@/lib/supabase/dev-auth';
import { isAppError } from '@/lib/supabase/edge';

import { useAiSmoke } from '../hooks/use-ai-smoke';
import { useDebugMenuEnabled } from '../hooks/use-debug-menu-enabled';

/** Sprint 0 demo screen: analytics round trip and the ai-smoke Edge Function (24, Sprint 0 demo). */
export function DebugScreen() {
  const { t } = useTranslation(['debug', 'errors']);
  const enabled = useDebugMenuEnabled();
  const debugFlag = useFeatureFlag('debug_menu');
  const [prompt, setPrompt] = useState(() => t('debug:aiSmoke.defaultPrompt'));
  const [analyticsStatus, setAnalyticsStatus] = useState<string | null>(null);
  const [queued, setQueued] = useState(() => analytics.size());
  const [flushing, setFlushing] = useState(false);
  const aiSmoke = useAiSmoke();
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentUserId().then(setUserId);
  }, []);

  if (!enabled) return null;

  const devSignIn = async () => {
    setSessionError(null);
    try {
      setUserId(await signInAsDevSeedUser());
      setAnalyticsContext({ householdId: DEV_SEED_HOUSEHOLD_ID });
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendTestEvent = async () => {
    track('debug_test_event', { source: 'debug_screen' });
    setQueued(analytics.size());
    setFlushing(true);
    try {
      const result = await flushAnalytics();
      setAnalyticsStatus(
        result.skipped === 'no_user'
          ? t('errors:unauthenticated')
          : t('debug:analytics.sent', { count: result.sent }),
      );
    } catch (error) {
      setAnalyticsStatus(
        t('debug:analytics.failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setFlushing(false);
      setQueued(analytics.size());
    }
  };

  const status = (ok: boolean) => (ok ? t('debug:configured') : t('debug:missing'));
  const error = aiSmoke.error;

  return (
    <Screen testID="debug-tools.screen">
      <Card>
        <Text variant="caption" tone="muted">
          {t('debug:environment', { env: env.APP_ENV })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('debug:version', { version: env.APP_VERSION })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('debug:supabase', { status: status(isSupabaseConfigured) })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('debug:sentry', { status: status(isSentryEnabled()) })}
        </Text>
        <Text variant="caption" tone="muted">
          {t('debug:flags.debugMenu', { value: String(debugFlag) })}
        </Text>
      </Card>

      <Card header={<Text variant="heading">{t('debug:session.title')}</Text>}>
        <Text tone="muted" testID="debug-tools.session-status">
          {userId ? t('debug:session.signedIn', { userId }) : t('debug:session.signedOut')}
        </Text>
        {!userId && isSupabaseConfigured && __DEV__ && env.APP_ENV === 'development' ? (
          <Button
            label={t('debug:session.signIn')}
            variant="secondary"
            onPress={() => void devSignIn()}
            testID="debug-tools.dev-sign-in-button"
          />
        ) : null}
        {sessionError ? <Text tone="danger">{sessionError}</Text> : null}
      </Card>

      <Card header={<Text variant="heading">{t('debug:analytics.title')}</Text>}>
        <Text tone="muted">{t('debug:analytics.queued', { count: queued })}</Text>
        <Button
          label={t('debug:analytics.send')}
          onPress={() => void sendTestEvent()}
          loading={flushing}
          testID="debug-tools.send-event-button"
        />
        {analyticsStatus ? (
          <Text testID="debug-tools.analytics-status">{analyticsStatus}</Text>
        ) : null}
      </Card>

      <Card header={<Text variant="heading">{t('debug:aiSmoke.title')}</Text>}>
        <Input
          label={t('debug:aiSmoke.promptLabel')}
          value={prompt}
          onChangeText={setPrompt}
          maxLength={500}
          testID="field.prompt"
        />
        <Button
          label={t('debug:aiSmoke.send')}
          onPress={() => aiSmoke.mutate({ prompt })}
          loading={aiSmoke.isPending}
          disabled={prompt.trim().length === 0}
          testID="debug-tools.ai-smoke-button"
        />
        {aiSmoke.data ? (
          <View className="gap-1" testID="debug-tools.ai-smoke-result">
            <Text variant="label" tone="muted">
              {t('debug:aiSmoke.reply')}
            </Text>
            <Text selectable>{aiSmoke.data.reply}</Text>
            <Text variant="caption" tone="subtle">
              {t('debug:aiSmoke.meta', {
                provider: aiSmoke.data.provider,
                model: aiSmoke.data.model,
                route: aiSmoke.data.route_key,
                tokensIn: aiSmoke.data.usage.tokens_in,
                tokensOut: aiSmoke.data.usage.tokens_out,
                latency: aiSmoke.data.latency_ms,
              })}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text tone="danger" testID="debug-tools.ai-smoke-error">
            {t('debug:aiSmoke.error', {
              code: isAppError(error) ? error.code : 'UNKNOWN',
              message: error.message,
            })}
          </Text>
        ) : null}
      </Card>

      <Button
        label={t('debug:sentryTest')}
        variant="ghost"
        onPress={() => captureException(new Error('Thuluth debug test error'))}
        testID="debug-tools.sentry-button"
      />
    </Screen>
  );
}
