import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { hasCurrentConsent, useConsents } from '@/features/auth';
import { useFamilyMembers } from '@/features/family';
import { useHousehold } from '@/features/household';
import { usePaywall, usePremium } from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import type { ChatScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { AssistantText, AssistantTurn, UserBubble } from '../components/assistant-turn';
import { QuotaIndicator, QuotaReachedCard } from '../components/chat-parts';
import { ChatComposer } from '../components/chat-composer';
import { useChatMessages, useChatSessions, useChatThread, useMemories } from '../hooks/use-chat';
import { useProposalActions } from '../hooks/use-proposals';
import { isTurnActive, newSentences } from '../utils/chat-stream';
import { sourceSheetParams } from '../utils/citation-rules';
import { quotaDisplay } from '../utils/quota-rules';

const STARTERS = ['picky', 'suhoor', 'honey', 'iron'] as const;
const ALL = 'all';

/**
 * C2 AI Nutrition Chat (02 §7.7.2, 24 S5-05, FR-CHAT-01, -06, -07, -09, -11, -12): streamed answers
 * over SSE, a member focus, a memory indicator, verified citation chips opening the source sheet,
 * confirmation cards for proposed writes, safety and crisis rendering with the country's emergency
 * numbers, follow-up chips, Stop, Retry, feedback, the free-tier counter and quota card, voice and
 * photo (premium). Offline the history stays readable and the composer is disabled.
 */
export function ChatThreadScreen({ route, navigation }: ChatScreenProps<'ChatThread'>) {
  const { t, i18n } = useTranslation(['chat', 'errors']);
  const insets = useSafeAreaInsets();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const online = useIsOnline();
  const chatOn = useFeatureFlag('ai.chat.enabled');
  const voiceOn = useFeatureFlag('ai.voice.enabled');
  const visionOn = useFeatureFlag('ai.vision.enabled');
  const { premium } = usePremium(householdId);
  const openPaywall = usePaywall();
  const household = useHousehold(householdId);
  const members = useFamilyMembers(householdId);
  const consents = useConsents();
  const sessions = useChatSessions(householdId);
  const memories = useMemories(householdId, premium);
  const thread = useChatThread(householdId, route.params?.sessionId ?? null);
  const history = useChatMessages(householdId, thread.sessionId);
  const proposals = useProposalActions(householdId);
  const [draft, setDraft] = useState(route.params?.prefill ?? '');
  const [focus, setFocus] = useState<string>(route.params?.familyMemberId ?? ALL);
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const [newReply, setNewReply] = useState(false);
  const announced = useRef({ id: '', length: 0, at: 0 });

  useEffect(() => {
    track('chat_session_opened', { is_new: !route.params?.sessionId });
  }, [route.params?.sessionId]);
  useEffect(() => {
    if (route.params?.prefill) setDraft(route.params.prefill);
  }, [route.params?.prefill]);

  const turnIds = useMemo(
    () => new Set(thread.turns.flatMap((x) => [x.userMessageId, x.assistantMessageId])),
    [thread.turns],
  );
  const past = useMemo(
    () =>
      (history.data?.pages ?? [])
        .flat()
        .filter((m) => !turnIds.has(m.id))
        .reverse(),
    [history.data, turnIds],
  );
  const last = thread.turns[thread.turns.length - 1] ?? null;
  const streaming = thread.turns.some((x) => isTurnActive(x));
  const quota = [...thread.turns].reverse().find((x) => x.quota)?.quota ?? null;
  const display = quotaDisplay(quota, premium);
  const aiConsent = consents.data ? hasCurrentConsent(consents.data.live, 'ai_processing') : true;
  const title =
    (sessions.data ?? []).find((s) => s.id === thread.sessionId)?.title || t('chat:newChat');
  const country = household.data?.country_code ?? null;

  // Screen readers hear completed sentences, at most every 2 s, then "Reply complete".
  useEffect(() => {
    if (!last) return;
    const a = announced.current;
    if (a.id !== last.clientMessageId)
      announced.current = { id: last.clientMessageId, length: 0, at: 0 };
    const now = Date.now();
    if (last.status === 'done') {
      if (a.length >= 0) AccessibilityInfo.announceForAccessibility(t('chat:replyComplete'));
      announced.current.length = -1;
      return;
    }
    if (announced.current.length < 0 || now - announced.current.at < 2000) return;
    const { sentences, nextLength } = newSentences(last.text, announced.current.length);
    if (sentences) {
      AccessibilityInfo.announceForAccessibility(sentences);
      announced.current = { id: last.clientMessageId, length: nextLength, at: now };
    }
  }, [last, t]);

  const send = (text: string, inputMode: 'text' | 'voice' = 'text') => {
    if (!text.trim()) return;
    thread.send({
      text,
      inputMode,
      focusMemberId: focus === ALL ? null : focus,
      screenContext: { screen: 'chat' },
      locale: i18n.language === 'ur' ? 'ur' : 'en',
    });
    setDraft('');
    atBottom.current = true;
  };

  const openPhoto = () =>
    navigation.navigate('MealPhotoCapture', {
      returnTo: 'chat',
      ...(focus !== ALL ? { familyMemberId: focus } : {}),
      ...(thread.sessionId ? { sessionId: thread.sessionId } : {}),
    });

  const memoryLabel = premium
    ? t('chat:memory.count', { count: memories.data?.length ?? 0 })
    : t('chat:memory.off');

  const disabled = !online || !canEdit || !chatOn || !householdId;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-surface"
      style={{ paddingTop: insets.top }}
      testID="chat-thread.screen"
    >
      <View className="gap-2 border-b border-line px-4 py-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="heading" accessibilityRole="header" numberOfLines={1} className="flex-1">
            {title}
          </Text>
          <Button
            label={t('chat:sessions.title')}
            size="sm"
            variant="ghost"
            onPress={() => navigation.navigate('ChatSessions')}
            testID="chat-thread.sessions"
          />
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button
            label={memoryLabel}
            size="sm"
            variant="ghost"
            accessibilityHint={t('chat:memory.hint')}
            onPress={() =>
              premium
                ? navigation.navigate('MoreTab', { screen: 'SettingsMemory', initial: false })
                : openPaywall('chat_quota')
            }
            testID="chat-thread.memory"
          />
        </View>
        {(members.data ?? []).length > 0 ? (
          <ChipGroup
            label={t('chat:about')}
            single
            options={[
              { value: ALL, label: t('chat:everyone') },
              ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name })),
            ]}
            selected={[focus]}
            onToggle={setFocus}
            testID="chat-thread.focus"
          />
        ) : null}
      </View>

      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="gap-4 px-4 py-4"
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          atBottom.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 48;
          if (atBottom.current) setNewReply(false);
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (atBottom.current) scroll.current?.scrollToEnd({ animated: true });
          else if (streaming) setNewReply(true);
        }}
        testID="chat-thread.messages"
      >
        {history.hasNextPage ? (
          <Button
            label={t('chat:loadEarlier')}
            size="sm"
            variant="ghost"
            loading={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          />
        ) : null}

        {!aiConsent ? (
          <Card variant="filled" testID="chat-thread.no-consent">
            <Text variant="bodyStrong">{t('chat:consent.title')}</Text>
            <Text tone="muted">{t('chat:consent.body')}</Text>
          </Card>
        ) : null}

        {past.length === 0 && thread.turns.length === 0 && aiConsent ? (
          <View className="gap-3" testID="chat-thread.empty">
            <Text variant="title">{t('chat:empty.title')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Button
                  key={s}
                  label={t(`chat:empty.starters.${s}`)}
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onPress={() => send(t(`chat:empty.starters.${s}`))}
                  testID={`chat-thread.starter.${s}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        {past.map((m) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} text={m.content} testID={`chat.history.${m.id}`} />
          ) : (
            <AssistantText key={m.id} text={m.content} testID={`chat.history.${m.id}`} />
          ),
        )}

        {thread.turns.map((turn, i) => (
          <View key={turn.clientMessageId} className="gap-3">
            <UserBubble text={turn.userText} testID={`chat.turn-${i}.user`} />
            <AssistantTurn
              turn={turn}
              countryCode={country}
              canEdit={canEdit}
              online={online}
              actionFor={proposals.actionFor}
              memberName={proposals.memberName}
              onConfirm={(p) =>
                void proposals.confirm(p, (status, code) =>
                  thread.setProposal(turn.clientMessageId, p.id, status, code),
                )
              }
              onDismiss={(p) =>
                proposals.dismiss(p, (status) =>
                  thread.setProposal(turn.clientMessageId, p.id, status),
                )
              }
              onReview={proposals.review}
              onRetry={() => thread.retry(turn.clientMessageId)}
              onOpenCitation={(c) => navigation.navigate('SourceDetailSheet', sourceSheetParams(c))}
              onFollowUp={(text) => send(text)}
              onPaywall={() => openPaywall('chat_quota')}
              busy={streaming}
              testID={`chat.turn-${i}.assistant`}
            />
          </View>
        ))}
      </ScrollView>

      {newReply ? (
        <Button
          label={t('chat:newReply')}
          size="sm"
          variant="secondary"
          className="self-center"
          onPress={() => {
            atBottom.current = true;
            setNewReply(false);
            scroll.current?.scrollToEnd({ animated: true });
          }}
          testID="chat-thread.new-reply"
        />
      ) : null}

      <View className="gap-2 px-4">
        {!online ? (
          <InlineMessage tone="info" message={t('chat:offline')} testID="chat-thread.offline" />
        ) : null}
        {!chatOn ? <InlineMessage tone="info" message={t('chat:disabled')} /> : null}
        {!canEdit ? <InlineMessage tone="info" message={t('chat:viewer')} /> : null}
        <QuotaIndicator display={display} />
      </View>

      <View style={{ paddingBottom: insets.bottom }}>
        {display.kind === 'reached' ? (
          <View className="px-4 py-3">
            <QuotaReachedCard premium={premium} onSeePremium={() => openPaywall('chat_quota')} />
          </View>
        ) : aiConsent ? (
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSend={(mode) => send(draft, mode)}
            onStop={thread.stop}
            streaming={streaming}
            disabled={disabled}
            premium={premium}
            voiceEnabled={voiceOn}
            photoEnabled={visionOn}
            householdId={householdId}
            locale={i18n.language}
            onPaywall={(trigger, intent) => openPaywall(trigger, intent)}
            onPhoto={openPhoto}
          />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
