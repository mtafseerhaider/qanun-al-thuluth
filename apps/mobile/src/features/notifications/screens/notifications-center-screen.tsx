import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListScreen } from '@/components/ui/list-screen';
import { ErrorRetry, LoadingRow } from '@/components/ui/query-states';
import { Text } from '@/components/ui/text';
import { Badge } from '@/features/meals';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { TodayScreenProps } from '@/navigation/types';

import {
  markNotificationsRead,
  openNotification,
  useInbox,
  type InboxItem,
} from '../hooks/use-notifications';

/**
 * S6 Notifications center (02 §7.13.1, 24 S4-14): the in-app inbox from `notifications`, newest
 * first. Tapping a row marks it read and opens its screen (hydration, meal, plan, fasting...).
 * Reminders held back by quiet hours are listed as "Arrived quietly" and open the same way.
 */
export function NotificationsCenterScreen({ navigation }: TodayScreenProps<'NotificationsCenter'>) {
  const { t, i18n } = useTranslation(['notifications', 'errors', 'common']);
  const inbox = useInbox();
  const unreadIds = inbox.items.filter((i) => !i.read).map((i) => i.id);

  const renderRow = useCallback(
    (n: InboxItem, i: number) => (
      <Card
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
            <Badge label={t('notifications:inbox.quiet')} testID={`notifications.row-${i}.quiet`} />
          ) : null}
        </View>
        <Text tone="muted">{n.body}</Text>
        <Text variant="caption" tone="subtle">
          {formatWhen(n.scheduledFor, i18n.language)}
        </Text>
      </Card>
    ),
    [t, i18n.language],
  );

  return (
    <ListScreen
      testID="notifications.screen"
      data={inbox.items}
      keyExtractor={(n) => n.id}
      renderItem={renderRow}
      refreshing={inbox.isRefetching}
      onRefresh={() => void inbox.refetch()}
      header={
        <>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
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
            <ErrorRetry
              message={t(`errors:${errorKeyFor(inbox.error)}`)}
              retryLabel={t('common:retry')}
              onRetry={() => void inbox.refetch()}
              retrying={inbox.isFetching}
              testID="notifications.error"
            />
          ) : null}
          {inbox.isLoading ? (
            <LoadingRow label={t('common:loading')} testID="notifications.loading" />
          ) : null}
        </>
      }
      empty={
        !inbox.isLoading && !inbox.isError ? (
          <Card variant="filled" testID="notifications.empty">
            <Text variant="bodyStrong">{t('notifications:inbox.emptyTitle')}</Text>
            <Text tone="muted">{t('notifications:inbox.emptyBody')}</Text>
          </Card>
        ) : null
      }
    />
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
