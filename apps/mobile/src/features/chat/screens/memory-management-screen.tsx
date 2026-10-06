import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { DowngradeBanner, UpsellCard, useEntitlements, usePremium } from '@/features/subscription';
import { useIsOnline } from '@/hooks/use-is-online';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import {
  useClearMemories,
  useDeleteMemory,
  useMemories,
  useMemoryEnabled,
} from '../hooks/use-chat';

/**
 * AI memory (24 S5-09, FR-CHAT-08, FR-SET-04, 12 §7.2): what the assistant remembers about the
 * family, with delete (removed from recall at once), "Clear all", and the memory on/off switch
 * (`users.ai_memory_enabled`). Memory is premium; after a downgrade memories are kept but not used
 * and stay deletable (17 §10.3). Health facts are never stored as memories.
 */
export function MemoryManagementScreen(_props: MoreScreenProps<'SettingsMemory'>) {
  const { t } = useTranslation(['chat', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const online = useIsOnline();
  const { premium } = usePremium(householdId);
  const ent = useEntitlements(householdId);
  const members = useFamilyMembers(householdId);
  const memories = useMemories(householdId, canEdit);
  const del = useDeleteMemory(householdId);
  const clear = useClearMemories(householdId);
  const memory = useMemoryEnabled();
  const [confirmClear, setConfirmClear] = useState(false);
  const name = (id: string | null) =>
    id ? ((members.data ?? []).find((m) => m.id === id)?.name ?? null) : null;
  const list = memories.data ?? [];

  return (
    <Screen
      testID="memory.screen"
      refreshing={memories.isRefetching}
      onRefresh={() => void memories.refetch()}
    >
      <Text tone="muted">{t('chat:memories.intro')}</Text>

      <Card variant="outlined">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong">{t('chat:memories.toggle')}</Text>
            <Text variant="caption" tone="muted">
              {t('chat:memories.toggleHint')}
            </Text>
          </View>
          <Switch
            value={memory.enabled}
            disabled={!online || memory.loading}
            onValueChange={(v) => memory.toggle.mutate(v)}
            accessibilityLabel={t('chat:memories.toggle')}
            testID="memory.toggle"
          />
        </View>
      </Card>

      {!premium ? (
        list.length > 0 ? (
          <DowngradeBanner notice="expired_read_only" testID="memory.downgrade" />
        ) : (
          <UpsellCard
            trigger="chat_quota"
            title={t('chat:memories.upsellTitle')}
            body={t('chat:memories.upsellBody')}
            testID="memory.upsell"
          />
        )
      ) : null}
      {ent.data && !premium && list.length > 0 ? (
        <Text variant="caption" tone="muted">
          {t('chat:memories.notUsed')}
        </Text>
      ) : null}

      {!canEdit ? <InlineMessage tone="info" message={t('chat:memories.viewer')} /> : null}
      {memories.isError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(memories.error)}`)} />
      ) : null}
      {del.isError || clear.isError ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(del.error ?? clear.error)}`)}
        />
      ) : null}

      {canEdit && !memories.isLoading && list.length === 0 ? (
        <Card variant="filled" testID="memory.empty">
          <Text tone="muted">{t('chat:memories.empty')}</Text>
        </Card>
      ) : null}

      <View className="gap-3">
        {list.map((m, i) => (
          <Card key={m.id} variant="outlined" padding="sm" testID={`memory.row-${i}`}>
            <Text>{m.fact}</Text>
            {name(m.familyMemberId) ? (
              <Text variant="caption" tone="muted">
                {t('chat:memories.about', { name: name(m.familyMemberId) })}
              </Text>
            ) : null}
            <Button
              label={t('chat:memories.delete')}
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={!online || del.isPending}
              accessibilityLabel={t('chat:memories.deleteA11y', { fact: m.fact })}
              onPress={() => del.mutate(m.id)}
              testID={`memory.row-${i}.delete`}
            />
          </Card>
        ))}
      </View>

      {list.length > 0 ? (
        confirmClear ? (
          <Card variant="outlined" testID="memory.clear-confirm">
            <Text>{t('chat:memories.clearConfirm')}</Text>
            <View className="flex-row gap-2">
              <Button
                label={t('chat:memories.clear')}
                variant="destructive"
                size="sm"
                disabled={!online}
                loading={clear.isPending}
                onPress={() => clear.mutate(undefined, { onSettled: () => setConfirmClear(false) })}
                testID="memory.clear-confirm.yes"
              />
              <Button
                label={t('chat:sessions.cancel')}
                variant="ghost"
                size="sm"
                onPress={() => setConfirmClear(false)}
              />
            </View>
          </Card>
        ) : (
          <Button
            label={t('chat:memories.clear')}
            variant="destructive"
            disabled={!online}
            onPress={() => setConfirmClear(true)}
            testID="memory.clear"
          />
        )
      ) : null}
    </Screen>
  );
}
