import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AiChatRequest } from '@shared/contracts';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import { isAppError } from '@/lib/supabase/app-error';
import { useSessionStore } from '@/stores/use-session-store';

import {
  CHAT_PAGE_SIZE,
  deleteChatSession,
  fetchChatMessages,
  fetchChatSessions,
  renameChatSession,
  streamChat,
} from '../api/chat-api';
import {
  clearMemories,
  deleteMemory,
  fetchMemories,
  fetchMemoryEnabled,
  setMemoryEnabled,
} from '../api/memories-api';
import {
  applyChatEvent,
  closeTurn,
  failTurn,
  newTurn,
  setProposalStatus,
  stopTurn,
  type ChatTurn,
  type ProposalStatus,
} from '../utils/chat-stream';

export function useChatSessions(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').chatSessions(),
    queryFn: () => fetchChatSessions(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

/** Message history, newest page first (02 §7.7.2: 30 per page). */
export function useChatMessages(householdId: string | null, sessionId: string | null) {
  return useInfiniteQuery({
    queryKey: qk.household(householdId ?? 'none').chatMessages(sessionId ?? 'none'),
    queryFn: ({ pageParam }) =>
      fetchChatMessages(householdId as string, sessionId as string, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length < CHAT_PAGE_SIZE ? null : (last[last.length - 1]?.createdAt ?? null),
    enabled: Boolean(householdId && sessionId) && isSupabaseConfigured,
  });
}

export function useRenameSession(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['chat', 'rename'],
    mutationFn: (v: { id: string; title: string }) => renameChatSession(v.id, v.title),
    onSuccess: () => {
      track('chat_session_renamed', {});
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).chatSessions() });
    },
  });
}

export function useDeleteSession(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['chat', 'delete'],
    mutationFn: (id: string) => deleteChatSession(id),
    onSuccess: () => {
      track('chat_session_deleted', {});
      if (!householdId) return;
      void qc.invalidateQueries({ queryKey: qk.household(householdId).chatSessions() });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).memories() });
    },
  });
}

export interface SendInput {
  text: string;
  inputMode?: 'text' | 'voice';
  focusMemberId?: string | null;
  screenContext?: AiChatRequest['screen_context'];
  locale?: 'en' | 'ur';
}

/**
 * One chat thread's live turns (02 §7.7.2): send streams `ai-chat` into a growing turn; Stop
 * aborts and keeps the partial text; Retry resends the same `client_message_id` (idempotent, 06
 * §4.1). Turns live in memory only (09 §9 "chat streaming buffer"); history comes from
 * `chat_messages`.
 */
export function useChatThread(householdId: string | null, initialSessionId: string | null) {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const inputs = useRef(new Map<string, SendInput>());

  useEffect(() => {
    setSessionId(initialSessionId);
    setTurns([]);
  }, [initialSessionId]);

  useEffect(() => {
    const live = controllers.current;
    return () => live.forEach((c) => c.abort());
  }, []);

  const update = useCallback((id: string, fn: (t: ChatTurn) => ChatTurn) => {
    setTurns((list) => list.map((t) => (t.clientMessageId === id ? fn(t) : t)));
  }, []);

  const run = useCallback(
    async (clientMessageId: string, input: SendInput, sid: string | null) => {
      if (!householdId) return;
      const controller = new AbortController();
      controllers.current.set(clientMessageId, controller);
      const started = Date.now();
      let firstTokenAt: number | null = null;
      try {
        await streamChat(
          {
            session_id: sid,
            household_id: householdId,
            client_message_id: clientMessageId,
            message: { text: input.text, input_mode: input.inputMode ?? 'text', attachments: [] },
            ...(input.focusMemberId ? { focus_family_member_id: input.focusMemberId } : {}),
            ...(input.screenContext ? { screen_context: input.screenContext } : {}),
            ...(input.locale ? { locale: input.locale } : {}),
          },
          (event) => {
            if (event.type === 'message.start') setSessionId(event.data.session_id);
            if (event.type === 'message.delta' && firstTokenAt === null) firstTokenAt = Date.now();
            if (event.type === 'safety') track('chat_safety_shown', { action: event.data.action });
            update(clientMessageId, (t) => applyChatEvent(t, event));
          },
          { signal: controller.signal },
        );
        update(clientMessageId, closeTurn);
        const end = Date.now();
        track('chat_stream_completed', {
          latency_first_token_ms: Math.min(600_000, (firstTokenAt ?? end) - started),
          duration_ms: Math.min(600_000, end - started),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          update(clientMessageId, stopTurn);
        } else if (isAppError(error)) {
          update(clientMessageId, (t) => failTurn(t, error.code, error.message));
          if (error.code === 'QUOTA_EXCEEDED')
            update(clientMessageId, (t) => ({
              ...t,
              quota: {
                limit: typeof error.details.limit === 'number' ? error.details.limit : 20,
                remaining: 0,
              },
            }));
        } else {
          update(clientMessageId, (t) =>
            failTurn(t, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Failed'),
          );
        }
      } finally {
        controllers.current.delete(clientMessageId);
        void qc.invalidateQueries({ queryKey: qk.household(householdId).chatSessions() });
      }
    },
    [householdId, qc, update],
  );

  const send = useCallback(
    (input: SendInput) => {
      const text = input.text.trim();
      if (!text || !householdId) return null;
      const clientMessageId = Crypto.randomUUID();
      inputs.current.set(clientMessageId, { ...input, text });
      setTurns((list) => [
        ...list,
        newTurn({
          clientMessageId,
          userText: text,
          inputMode: input.inputMode ?? 'text',
          sessionId,
        }),
      ]);
      track('chat_message_sent', {
        has_attachment: false,
        input: input.inputMode ?? 'text',
        member_scoped: Boolean(input.focusMemberId),
      });
      void run(clientMessageId, { ...input, text }, sessionId);
      return clientMessageId;
    },
    [householdId, run, sessionId],
  );

  const stop = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    track('chat_stopped', {});
  }, []);

  const retry = useCallback(
    (clientMessageId: string) => {
      const input = inputs.current.get(clientMessageId);
      if (!input) return;
      setTurns((list) =>
        list.map((t) =>
          t.clientMessageId === clientMessageId
            ? newTurn({
                clientMessageId,
                userText: t.userText,
                inputMode: t.inputMode,
                sessionId: t.sessionId ?? sessionId,
              })
            : t,
        ),
      );
      void run(clientMessageId, input, sessionId);
    },
    [run, sessionId],
  );

  const setProposal = useCallback(
    (clientMessageId: string, proposalId: string, status: ProposalStatus, code?: string) =>
      update(clientMessageId, (t) => setProposalStatus(t, proposalId, status, code)),
    [update],
  );

  return { sessionId, turns, send, stop, retry, setProposal };
}

export function useMemories(householdId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').memories(),
    queryFn: () => fetchMemories(householdId as string),
    enabled: enabled && Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useDeleteMemory(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['memory', 'delete'],
    networkMode: 'online',
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      track('memory_deleted', { all: false });
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).memories() });
    },
  });
}

export function useClearMemories(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['memory', 'clear'],
    networkMode: 'online',
    mutationFn: () => clearMemories(householdId as string),
    onSuccess: () => {
      track('memory_deleted', { all: true });
      if (householdId)
        void qc.invalidateQueries({ queryKey: qk.household(householdId).memories() });
    },
  });
}

export function useMemoryEnabled() {
  const userId = useSessionStore((s) => s.userId);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.memoryEnabled(),
    queryFn: () => fetchMemoryEnabled(userId as string),
    enabled: Boolean(userId) && isSupabaseConfigured,
  });
  const toggle = useMutation({
    mutationKey: ['memory', 'toggle'],
    networkMode: 'online',
    mutationFn: (enabled: boolean) => setMemoryEnabled(userId as string, enabled),
    onMutate: (enabled) => qc.setQueryData(qk.memoryEnabled(), enabled),
    onSuccess: (_r, enabled) => track('memory_toggled', { enabled }),
    onError: () => void qc.invalidateQueries({ queryKey: qk.memoryEnabled() }),
  });
  return { enabled: query.data ?? true, loading: query.isLoading, toggle };
}
