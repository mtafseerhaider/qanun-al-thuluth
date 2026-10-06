import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { getPushPermission, requestPushPermission } from '@/lib/push/push';
import { registerPushDevice } from '@/lib/push/push-registration';
import { appStorage, type KeyValueStore } from '@/lib/storage/mmkv';
import { useSessionStore } from '@/stores/use-session-store';

export const PREPROMPT_DISMISSED_KEY = 'push.preprompt.dismissed-at';
/** "Not now" hides the card for two weeks (02 §7.2.6: never nag). */
const SNOOZE_MS = 14 * 24 * 60 * 60_000;

export function prePromptSnoozed(store: KeyValueStore = appStorage, now = Date.now()): boolean {
  const at = Number(store.getString(PREPROMPT_DISMISSED_KEY) ?? 0);
  return Number.isFinite(at) && at > 0 && now - at < SNOOZE_MS;
}

/**
 * Push pre-prompt (02 §7.2.6, 24 S4-12): shown on Today once the family has its first plan, only
 * while the OS permission is undetermined. "Turn on" opens the OS prompt; "Not now" snoozes.
 */
export function PushPrePrompt({ hasPlan }: { hasPlan: boolean }) {
  const { t } = useTranslation('notifications');
  const userId = useSessionStore((s) => s.userId);
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (!hasPlan || prePromptSnoozed()) return;
    let alive = true;
    void getPushPermission().then((p) => {
      if (alive && p === 'undetermined') setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, [hasPlan]);

  useEffect(() => {
    if (visible && !shown.current) {
      shown.current = true;
      track('push_preprompt', { action: 'shown' });
    }
  }, [visible]);

  if (!visible) return null;

  const allow = async () => {
    track('push_preprompt', { action: 'allow' });
    setVisible(false);
    const granted = await requestPushPermission();
    track('push_permission_result', { granted });
    if (granted && userId) void registerPushDevice(userId);
  };
  const notNow = () => {
    track('push_preprompt', { action: 'not_now' });
    appStorage.set(PREPROMPT_DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <Card variant="filled" testID="push-preprompt">
      <Text variant="bodyStrong">{t('preprompt.title')}</Text>
      <Text tone="muted">{t('preprompt.body')}</Text>
      <View className="flex-row gap-2">
        <Button
          label={t('preprompt.allow')}
          size="sm"
          onPress={() => void allow()}
          testID="push-preprompt.allow"
        />
        <Button
          label={t('preprompt.notNow')}
          size="sm"
          variant="ghost"
          onPress={notNow}
          testID="push-preprompt.not-now"
        />
      </View>
    </Card>
  );
}
