import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHousehold } from '@/features/household';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import { getPushPermission, requestPushPermission, type PushPermission } from '@/lib/push/push';
import { registerPushDevice } from '@/lib/push/push-registration';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import { usePreferences, useSavePreference, useSaveQuietHours } from '../hooks/use-notifications';
import {
  ALWAYS_ON_KINDS,
  DEFAULT_OFF_KINDS,
  isValidHhmm,
  NOTIFICATION_GROUPS,
  QUIET_EXEMPT_KINDS,
} from '../utils/notification-preferences';

/**
 * S5 Notification settings (02 §7.13.5, 24 S4-14, FR-NOT-01 to -03): push permission, one toggle
 * per kind grouped as in the spec, and quiet hours. Child safety alerts cannot be switched off;
 * suhoor and iftar reminders ignore quiet hours. Saved online.
 */
export function SettingsNotificationsScreen(_props: MoreScreenProps<'SettingsNotifications'>) {
  const { t } = useTranslation(['notifications', 'errors']);
  const userId = useSessionStore((s) => s.userId);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const household = useHousehold(householdId);
  const online = useIsOnline();
  const prefs = usePreferences();
  const save = useSavePreference();
  const saveQuiet = useSaveQuietHours();
  const [permission, setPermission] = useState<PushPermission>('unavailable');

  useEffect(() => {
    void getPushPermission().then(setPermission);
  }, []);

  const rows = prefs.data ?? [];
  const quiet = rows.find((r) => r.quietHours.start)?.quietHours ?? {};
  const [quietOn, setQuietOn] = useState<boolean | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const qOn = quietOn ?? Boolean(quiet.start);
  const qStart = start ?? quiet.start ?? '22:00';
  const qEnd = end ?? quiet.end ?? '06:30';
  const tz = quiet.tz ?? household.data?.timezone ?? 'Asia/Karachi';
  const quietValid = !qOn || (isValidHhmm(qStart) && isValidHhmm(qEnd) && qStart !== qEnd);

  const enabledFor = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? row.enabled : !DEFAULT_OFF_KINDS.has(kind);
  };

  const askPermission = async () => {
    if (permission === 'denied') {
      void Linking.openSettings();
      return;
    }
    const granted = await requestPushPermission();
    track('push_permission_result', { granted });
    setPermission(await getPushPermission());
    if (granted && userId) void registerPushDevice(userId);
  };

  return (
    <Screen testID="notification-settings.screen">
      <Card testID="notification-settings.push">
        <Text variant="heading">{t('notifications:settings.pushTitle')}</Text>
        <Text tone="muted" testID={`notification-settings.push.${permission}`}>
          {t(`notifications:settings.push.${permission}`)}
        </Text>
        {permission === 'undetermined' || permission === 'denied' ? (
          <Button
            label={
              permission === 'denied'
                ? t('notifications:settings.openSettings')
                : t('notifications:settings.turnOn')
            }
            variant="secondary"
            size="sm"
            onPress={() => void askPermission()}
            testID="notification-settings.push.ask"
          />
        ) : null}
      </Card>

      {!online ? <InlineMessage tone="info" message={t('notifications:settings.offline')} /> : null}
      {save.isError || saveQuiet.isError ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(save.error ?? saveQuiet.error)}`)}
        />
      ) : null}

      {NOTIFICATION_GROUPS.map((g) => (
        <Card key={g.key} testID={`notification-settings.group.${g.key}`}>
          <Text variant="overline" tone="muted" accessibilityRole="header">
            {t(`notifications:groups.${g.key}`)}
          </Text>
          {g.kinds.map((kind) => {
            const locked = ALWAYS_ON_KINDS.has(kind);
            return (
              <Checkbox
                key={kind}
                label={t(`notifications:kinds.${kind}.title`)}
                description={
                  locked
                    ? t('notifications:settings.alwaysOn')
                    : t(`notifications:kinds.${kind}.body`)
                }
                checked={locked || enabledFor(kind)}
                disabled={locked || !online || !prefs.data}
                onChange={(enabled) => save.mutate({ kind, enabled, quietHours: quiet })}
                testID={`notification-settings.kind.${kind}`}
              />
            );
          })}
        </Card>
      ))}

      <Card testID="notification-settings.quiet">
        <Text variant="heading">{t('notifications:quiet.title')}</Text>
        <Checkbox
          label={t('notifications:quiet.toggle')}
          description={t('notifications:quiet.body', {
            kinds: [...QUIET_EXEMPT_KINDS]
              .map((k) => t(`notifications:kinds.${k}.title`))
              .join(', '),
          })}
          checked={qOn}
          onChange={setQuietOn}
          disabled={!online}
          testID="notification-settings.quiet.toggle"
        />
        {qOn ? (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input
                label={t('notifications:quiet.start')}
                value={qStart}
                onChangeText={setStart}
                placeholder="22:00"
                maxLength={5}
                testID="notification-settings.quiet.start"
              />
            </View>
            <View className="flex-1">
              <Input
                label={t('notifications:quiet.end')}
                value={qEnd}
                onChangeText={setEnd}
                placeholder="06:30"
                maxLength={5}
                testID="notification-settings.quiet.end"
              />
            </View>
          </View>
        ) : null}
        {!quietValid ? (
          <Text tone="danger" testID="notification-settings.quiet.error">
            {t('notifications:quiet.invalid')}
          </Text>
        ) : null}
        <Button
          label={t('notifications:quiet.save')}
          size="sm"
          disabled={!online || !quietValid || !userId}
          loading={saveQuiet.isPending}
          onPress={() =>
            saveQuiet.mutate(qOn ? { start: qStart, end: qEnd, tz } : {}, {
              onSuccess: () => {
                setQuietOn(null);
                setStart(null);
                setEnd(null);
              },
            })
          }
          testID="notification-settings.quiet.save"
        />
      </Card>
    </Screen>
  );
}
