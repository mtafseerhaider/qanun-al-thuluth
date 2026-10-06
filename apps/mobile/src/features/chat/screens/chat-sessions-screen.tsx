import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { ChatScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useChatSessions, useDeleteSession, useRenameSession } from '../hooks/use-chat';

/** "2h ago" style without a dependency; Western digits (08 §10.3). */
function relative(iso: string | null, locale: string): string {
  if (!iso) return '';
  const diff = Date.parse(iso) - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

/**
 * C1 Chat Sessions (02 §7.7.1, FR-CHAT-11): newest first, client-side title search, rename and
 * delete (soft delete; derived memories are withdrawn server-side). Delete is a visible button, not
 * a swipe only. Offline: the cached list stays readable and new chat is disabled.
 */
export function ChatSessionsScreen({ navigation }: ChatScreenProps<'ChatSessions'>) {
  const { t, i18n } = useTranslation(['chat', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const online = useIsOnline();
  const sessions = useChatSessions(householdId);
  const rename = useRenameSession(householdId);
  const remove = useDeleteSession(householdId);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const list = (sessions.data ?? []).filter((s) => !q || s.title.toLowerCase().includes(q));

  return (
    <Screen
      title={t('chat:sessions.title')}
      testID="chat-sessions.screen"
      refreshing={sessions.isRefetching}
      onRefresh={() => void sessions.refetch()}
    >
      <Button
        label={t('chat:newChat')}
        disabled={!online}
        onPress={() => navigation.navigate('ChatThread', {})}
        testID="chat-sessions.new"
      />
      <Input
        label={t('chat:sessions.search')}
        value={search}
        onChangeText={setSearch}
        variant="search"
        testID="chat-sessions.search"
      />
      {sessions.isError && !sessions.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(sessions.error)}`)} />
      ) : null}
      {!sessions.isLoading && list.length === 0 ? (
        <Card variant="filled" testID="chat-sessions.empty">
          <Text tone="muted">{q ? t('chat:sessions.noMatch') : t('chat:sessions.empty')}</Text>
        </Card>
      ) : null}
      <View className="gap-3">
        {list.map((s, i) => (
          <Card key={s.id} variant="outlined" testID={`chat-sessions.row-${i}`}>
            {editing?.id === s.id ? (
              <View className="gap-2">
                <Input
                  label={t('chat:sessions.renameLabel')}
                  value={editing.title}
                  onChangeText={(title) => setEditing({ id: s.id, title: title.slice(0, 120) })}
                  testID={`chat-sessions.row-${i}.title-input`}
                />
                <View className="flex-row gap-2">
                  <Button
                    label={t('chat:sessions.save')}
                    size="sm"
                    disabled={!editing.title.trim()}
                    onPress={() => {
                      rename.mutate({ id: s.id, title: editing.title });
                      setEditing(null);
                    }}
                  />
                  <Button
                    label={t('chat:sessions.cancel')}
                    size="sm"
                    variant="ghost"
                    onPress={() => setEditing(null)}
                  />
                </View>
              </View>
            ) : (
              <Button
                label={s.title || t('chat:untitled')}
                variant="link"
                className="self-start px-0"
                accessibilityHint={relative(s.lastMessageAt ?? s.createdAt, i18n.language)}
                onPress={() => navigation.navigate('ChatThread', { sessionId: s.id })}
                testID={`chat-sessions.row-${i}.open`}
              />
            )}
            <Text variant="caption" tone="muted">
              {relative(s.lastMessageAt ?? s.createdAt, i18n.language)}
            </Text>
            {confirmDelete === s.id ? (
              <View className="gap-2">
                <Text>{t('chat:sessions.deleteConfirm')}</Text>
                <View className="flex-row gap-2">
                  <Button
                    label={t('chat:sessions.delete')}
                    variant="destructive"
                    size="sm"
                    disabled={!online}
                    onPress={() => {
                      remove.mutate(s.id);
                      setConfirmDelete(null);
                    }}
                    testID={`chat-sessions.row-${i}.delete-confirm`}
                  />
                  <Button
                    label={t('chat:sessions.cancel')}
                    size="sm"
                    variant="ghost"
                    onPress={() => setConfirmDelete(null)}
                  />
                </View>
              </View>
            ) : (
              <View className="flex-row gap-2">
                <Button
                  label={t('chat:sessions.rename')}
                  size="sm"
                  variant="ghost"
                  disabled={!online}
                  onPress={() => setEditing({ id: s.id, title: s.title })}
                />
                <Button
                  label={t('chat:sessions.delete')}
                  size="sm"
                  variant="ghost"
                  disabled={!online}
                  onPress={() => setConfirmDelete(s.id)}
                  testID={`chat-sessions.row-${i}.delete`}
                />
              </View>
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
