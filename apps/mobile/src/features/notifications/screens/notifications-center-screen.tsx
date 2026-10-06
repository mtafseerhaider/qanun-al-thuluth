import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Badge } from '@/features/meals';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { TodayScreenProps } from '@/navigation/types';

import { markNotificationsRead, openNotification, useInbox } from '../hooks/use-notifications';

/**
 * S6 Notifications center (02 §7.13.1, 24 S4-14): the in-app inbox from `notifications`, newest
 * first. Tapping a row marks it read and opens its screen (hydration, meal, plan, fasting...).
 * Reminders held back by quiet hours are listed as "Arrived quietly" and open the same way.
 */
export function NotificationsCenterScreen({ navigation }: TodayScreenProps<'NotificationsCenter'>) {
  const { t, i18n } = useTranslation(['notifications', 'errors']);
  const inbox = useInbox();
  const unreadIds = inbox.items.filter((i) => !i.read).map((i) => i.id);

  return (
    <Screen
      testID="notifications.screen"
      refreshing={inbox.isRefetching}
      onRefresh={() => void inbox.refetch()}
    >
      <View className="flex-row items-center justify-between">
        <Button
          label={t('notifications:inbox.settings')}
          variant="link"
          onPress={() =>
            navigation.navigate('MoreTab', {
              screen: 'SettingsNotifications',
              initial: false,
            })
          }
          testID="notifications.settings"
        />
        {unreadIds.length > 0 ? (
          <Button
            label={t('notifications:inbox.markAll')}
            variant="ghost"
            size="sm"
            onPress={() => markNotificationsRead(unreadIds)}
            testID="notifications.mark-all"
          />
        ) : null}
      </View>
      {inbox.isError && !inbox.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(inbox.error)}`)} />
      ) : null}
      {!inbox.isLoading && inbox.items.length === 0 ? (
        <Card variant="filled" testID="notifications.empty">
          <Text variant="bodyStrong">{t('notifications:inbox.emptyTitle')}</Text>
          <Text tone="muted">{t('notifications:inbox.emptyBody')}</Text>
        </Card>
      ) : null}
      {inbox.items.map((n, i) => (
        <Card
          key={n.id}
          variant={n.read ? 'outlined' : 'elevated'}
          onPress={() => openNotification(n, 'in_app')}
          accessibilityLabel={t('notifications:inbox.rowA11y', {
            title: n.title,
            state: n.read ? t('notifications:inbox.read') : t('notifications:inbox.unread'),
          })}
          testID={`notifications.row-${i}`}
        >
          <View className="flex-row flex-wrap items-center gap-2">
            {!n.read ? (
              <View
                className="h-2 w-2 rounded-full bg-primary"
                testID={`notifications.row-${i}.unread`}
              />
            ) : null}
            <Text variant="bodyStrong" className="flex-1">
              {n.title}
            </Text>
            {n.delivery === 'quiet' ? (
              <Badge
                label={t('notifications:inbox.quiet')}
                testID={`notifications.row-${i}.quiet`}
              />
            ) : null}
          </View>
          <Text tone="muted">{n.body}</Text>
          <Text variant="caption" tone="subtle">
            {formatWhen(n.scheduledFor, i18n.language)}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

function formatWhen(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'ur' ? 'ur-PK-u-nu-latn' : locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
