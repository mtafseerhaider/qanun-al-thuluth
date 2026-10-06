import { ChatSseEvent, type ChatToolCard } from '@shared/contracts';

import type { SseMessage } from '@/lib/sse/sse-parser';

/**
 * Streaming bubble assembly for `ai-chat` (02 §7.7.2, 06 §4.1, 12 §10). Every SSE event folds into
 * one immutable `ChatTurn` through `applyChatEvent`, a pure reducer: the screen renders the turn as
 * it grows. Tool proposals (plan adjustment, log) are recorded as `pending` and nothing here ever
 * moves them on: only an explicit user tap (`setProposalStatus`) can (FR-CHAT-06, 12 §10.3).
 */

export type ChatEvent = ChatSseEvent;
type EventData<T extends ChatEvent['type']> = Extract<ChatEvent, { type: T }>['data'];
export type ChatCitation = EventData<'citation'>;
export type ChatSafety = EventData<'safety'>;
export type ChatErrorData = EventData<'error'>;

export type ProposalCard = Extract<
  ChatToolCard,
  { kind: 'plan_adjustment_proposal' | 'log_proposal' }
>;
export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'dismissed' | 'failed';

export interface ChatProposal {
  /** The tool call id; unique within a turn. */
  id: string;
  card: ProposalCard;
  status: ProposalStatus;
  errorCode?: string;
}

export interface ChatToolStatus {
  id: string;
  name: string;
  display: string;
  ok: boolean | null;
  summary: string | null;
}

export type TurnStatus = 'sending' | 'streaming' | 'done' | 'error' | 'stopped';

export interface ChatTurn {
  clientMessageId: string;
  userText: string;
  inputMode: 'text' | 'voice';
  sessionId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  status: TurnStatus;
  text: string;
  tools: ChatToolStatus[];
  proposals: ChatProposal[];
  recipeIds: string[];
  citations: ChatCitation[];
  safety: ChatSafety | null;
  followUps: string[];
  quota: { limit: number; remaining: number } | null;
  finishReason: EventData<'done'>['finish_reason'] | null;
  replayed: boolean;
  error: ChatErrorData | { code: string; message: string; retryable: boolean } | null;
}

export function newTurn(input: {
  clientMessageId: string;
  userText: string;
  inputMode?: 'text' | 'voice';
  sessionId?: string | null;
}): ChatTurn {
  return {
    clientMessageId: input.clientMessageId,
    userText: input.userText,
    inputMode: input.inputMode ?? 'text',
    sessionId: input.sessionId ?? null,
    userMessageId: null,
    assistantMessageId: null,
    status: 'sending',
    text: '',
    tools: [],
    proposals: [],
    recipeIds: [],
    citations: [],
    safety: null,
    followUps: [],
    quota: null,
    finishReason: null,
    replayed: false,
    error: null,
  };
}

/** Parses one wire event leniently: an unknown or malformed event is dropped, never thrown. */
export function parseChatEvent(m: SseMessage): ChatEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(m.data);
  } catch {
    return null;
  }
  const parsed = ChatSseEvent.safeParse({ type: m.event, data });
  return parsed.success ? parsed.data : null;
}

const isFinal = (s: TurnStatus) => s === 'done' || s === 'error' || s === 'stopped';

export function applyChatEvent(turn: ChatTurn, event: ChatEvent): ChatTurn {
  // A stopped turn keeps its partial text; late events from the cancelled stream are ignored.
  if (isFinal(turn.status)) return turn;
  switch (event.type) {
    case 'message.start':
      return {
        ...turn,
        status: 'streaming',
        sessionId: event.data.session_id,
        userMessageId: event.data.user_message_id,
        assistantMessageId: event.data.assistant_message_id,
        quota: event.data.quota,
      };
    case 'message.delta':
      return { ...turn, status: 'streaming', text: turn.text + event.data.text };
    case 'tool.call':
      if (turn.tools.some((t) => t.id === event.data.tool_call_id)) return turn;
      return {
        ...turn,
        tools: [
          ...turn.tools,
          {
            id: event.data.tool_call_id,
            name: event.data.name,
            display: event.data.display,
            ok: null,
            summary: null,
          },
        ],
      };
    case 'tool.result': {
      const d = event.data;
      const known = turn.tools.some((t) => t.id === d.tool_call_id);
      const tools = known
        ? turn.tools.map((t) =>
            t.id === d.tool_call_id ? { ...t, ok: d.ok, summary: d.summary ?? null } : t,
          )
        : [
            ...turn.tools,
            { id: d.tool_call_id, name: d.name, display: '', ok: d.ok, summary: d.summary ?? null },
          ];
      let { proposals, recipeIds } = turn;
      const card = d.ok ? d.card : undefined;
      if (card?.kind === 'recipe' && !recipeIds.includes(card.recipe_id))
        recipeIds = [...recipeIds, card.recipe_id];
      if (
        card &&
        (card.kind === 'plan_adjustment_proposal' || card.kind === 'log_proposal') &&
        !proposals.some((p) => p.id === d.tool_call_id)
      )
        // Always recorded as pending: nothing is written until the user confirms.
        proposals = [...proposals, { id: d.tool_call_id, card, status: 'pending' }];
      return { ...turn, tools, proposals, recipeIds };
    }
    case 'citation':
      if (turn.citations.some((c) => c.marker === event.data.marker)) return turn;
      return { ...turn, citations: [...turn.citations, event.data] };
    case 'safety':
      // At most one per turn (06 §4.1); an escalation outranks a notice.
      if (turn.safety?.action === 'escalate') return turn;
      return { ...turn, safety: event.data };
    case 'follow_up':
      return { ...turn, followUps: event.data.suggestions.slice(0, 3) };
    case 'done':
      return {
        ...turn,
        status: event.data.finish_reason === 'cancelled' ? 'stopped' : 'done',
        assistantMessageId: event.data.assistant_message_id,
        finishReason: event.data.finish_reason,
        replayed: event.data.replayed,
      };
    case 'error':
      return { ...turn, status: 'error', error: event.data };
  }
}

/** Ends a turn whose stream closed without `done` or `error` (dropped connection). */
export function closeTurn(turn: ChatTurn): ChatTurn {
  if (isFinal(turn.status)) return turn;
  return {
    ...turn,
    status: 'error',
    error: { code: 'NETWORK_ERROR', message: 'The stream ended early.', retryable: true },
  };
}

/** Stop: cancels the request and keeps partial text marked "Stopped" (02 §7.7.2). */
export function stopTurn(turn: ChatTurn): ChatTurn {
  if (isFinal(turn.status)) return turn;
  return { ...turn, status: 'stopped', finishReason: 'cancelled' };
}

/** A request that failed before the stream started (quota, premium, consent, network). */
export function failTurn(turn: ChatTurn, code: string, message: string): ChatTurn {
  if (isFinal(turn.status)) return turn;
  return {
    ...turn,
    status: 'error',
    error: { code, message, retryable: code !== 'QUOTA_EXCEEDED' },
  };
}

/** The only way a proposal changes state: called from the confirmation card's buttons. */
export function setProposalStatus(
  turn: ChatTurn,
  proposalId: string,
  status: ProposalStatus,
  errorCode?: string,
): ChatTurn {
  return {
    ...turn,
    proposals: turn.proposals.map((p) =>
      p.id === proposalId ? { ...p, status, ...(errorCode ? { errorCode } : {}) } : p,
    ),
  };
}

/** The tool line shown while working: the latest tool call without a result. */
export function activeToolDisplay(turn: ChatTurn): string | null {
  if (isFinal(turn.status)) return null;
  const running = [...turn.tools].reverse().find((t) => t.ok === null && t.display);
  return running?.display ?? null;
}

export function isTurnActive(turn: ChatTurn | null | undefined): boolean {
  return Boolean(turn) && !isFinal((turn as ChatTurn).status);
}

/**
 * Sentence boundaries for screen-reader announcements (02 §7.7.2 accessibility): returns the
 * completed sentences in `text` after `announcedLength` characters, and the new announced length.
 */
export function newSentences(
  text: string,
  announcedLength: number,
): { sentences: string; nextLength: number } {
  const rest = text.slice(announcedLength);
  const re = /[.!?۔؟]\s/g;
  let end = -1;
  for (let m = re.exec(rest); m; m = re.exec(rest)) end = m.index + 1;
  if (end === -1) return { sentences: '', nextLength: announcedLength };
  return { sentences: rest.slice(0, end).trim(), nextLength: announcedLength + end };
}
