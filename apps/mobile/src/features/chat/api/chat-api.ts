import { fetch as expoFetch } from 'expo/fetch';

import { AiAdjustPlanRequest, AiAdjustPlanResponse, AiChatRequest } from '@shared/contracts';

import { readSseStream, type ByteStreamReader } from '@/lib/sse/sse-parser';
import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { edgeErrorFrom, edgeRequestInit, invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import { parseChatEvent, type ChatEvent } from '../utils/chat-stream';

/**
 * Chat reads and the `ai-chat` stream (06 §3.8, §4.1). Sessions and messages are read through
 * PostgREST (sessions are private to their user by RLS); every write goes through `ai-chat`,
 * except rename (UPDATE on `title` only) and delete (`soft_delete` RPC, which also withdraws the
 * memories sourced from the session, FR-CHAT-11).
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface ChatSessionView {
  id: string;
  title: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export async function fetchChatSessions(householdId: string): Promise<ChatSessionView[]> {
  const { data, error } = await client()
    .from('chat_sessions')
    .select('id, title, last_message_at, created_at')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    lastMessageAt: s.last_message_at,
    createdAt: s.created_at,
  }));
}

export async function renameChatSession(id: string, title: string): Promise<void> {
  const { error } = await client()
    .from('chat_sessions')
    .update({ title: title.trim().slice(0, 120) })
    .eq('id', id);
  if (error) throw toDbAppError(error);
}

export async function deleteChatSession(id: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', { p_table: 'chat_sessions', p_id: id });
  if (error) throw toDbAppError(error);
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  safetyFlags: string[];
}

export const CHAT_PAGE_SIZE = 30;

/** Newest first, 30 per page (02 §7.7.2); `before` is the created_at cursor of the oldest loaded. */
export async function fetchChatMessages(
  householdId: string,
  sessionId: string,
  before?: string,
): Promise<ChatMessageView[]> {
  let q = client()
    .from('chat_messages')
    .select('id, role, content, created_at, safety_flags')
    .eq('session_id', sessionId)
    .eq('household_id', householdId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw toDbAppError(error);
  return (data ?? []).map((m) => ({
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    createdAt: m.created_at,
    safetyFlags: m.safety_flags ?? [],
  }));
}

/** Minimal response shape used by the stream (both `expo/fetch` and test doubles satisfy it). */
export interface StreamingResponse {
  ok: boolean;
  status: number;
  body: { getReader(): ByteStreamReader } | null;
  json(): Promise<unknown>;
}
export type StreamingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<StreamingResponse>;

const defaultFetch: StreamingFetch = (url, init) =>
  expoFetch(url, init) as unknown as Promise<StreamingResponse>;

/**
 * POSTs a turn and calls `onEvent` for every parsed SSE event as it arrives. Errors before the
 * stream (quota, premium, consent, validation) arrive as the JSON envelope and are thrown as
 * AppError. Aborting the signal rejects with an AbortError, which the caller treats as "Stopped".
 */
export async function streamChat(
  request: AiChatRequest,
  onEvent: (e: ChatEvent) => void,
  opts: { signal?: AbortSignal; fetchImpl?: StreamingFetch } = {},
): Promise<void> {
  const body = AiChatRequest.parse(request);
  const { url, headers } = await edgeRequestInit('ai-chat');
  let res: StreamingResponse;
  try {
    res = await (opts.fetchImpl ?? defaultFetch)(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new AppError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network request failed.',
    );
  }
  if (!res.ok) {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    throw edgeErrorFrom('ai-chat', res.status, json);
  }
  if (!res.body) throw new AppError('INVALID_RESPONSE', 'ai-chat returned no stream.');
  await readSseStream(res.body.getReader(), (m) => {
    const event = parseChatEvent(m);
    if (event) onEvent(event);
  });
}

/**
 * Which cited rows are verified right now (FR-CHAT-09, 13 §5.4): Islamic sources through the
 * verified view, recommendations with `review_status = 'verified'`, and existing evidence rows.
 */
export async function fetchVerifiedCitationRefs(ids: {
  islamicSources: readonly string[];
  recommendations: readonly string[];
  evidence: readonly string[];
}): Promise<{ islamicSources: string[]; recommendations: string[]; evidence: string[] }> {
  const db = client();
  const pick = (rows: unknown) => ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
  const [sources, recs, ev] = await Promise.all([
    ids.islamicSources.length
      ? db
          .from('islamic_sources_public')
          .select('id')
          .in('id', [...ids.islamicSources])
      : Promise.resolve({ data: [], error: null }),
    ids.recommendations.length
      ? db
          .from('recommendations')
          .select('id')
          .eq('review_status', 'verified')
          .in('id', [...ids.recommendations])
      : Promise.resolve({ data: [], error: null }),
    ids.evidence.length
      ? db
          .from('scientific_evidence')
          .select('id')
          .in('id', [...ids.evidence])
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [sources, recs, ev]) if (r.error) throw toDbAppError(r.error);
  return {
    islamicSources: pick(sources.data),
    recommendations: pick(recs.data),
    evidence: pick(ev.data),
  };
}

/**
 * Applies a confirmed plan adjustment proposal through `ai-adjust-plan` (premium, 06 §4.4) with
 * `source = 'chat_proposal'`. A completed adjustment is activated; an async one is followed on the
 * plan progress screen.
 */
export async function applyPlanAdjustment(input: {
  mealPlanId: string;
  changeRequest: string;
  fromDate: string;
  toDate: string;
  idempotencyKey: string;
}): Promise<{ kind: 'completed' | 'accepted'; mealPlanId: string | null }> {
  const body = AiAdjustPlanRequest.parse({
    meal_plan_id: input.mealPlanId,
    change_request: input.changeRequest,
    scope: { from_date: input.fromDate, to_date: input.toDate },
    dry_run: false,
    source: 'chat_proposal',
  });
  const res = await invokeEdge('ai-adjust-plan', body, AiAdjustPlanResponse, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return res.status === 'completed'
    ? { kind: 'completed', mealPlanId: res.meal_plan_id }
    : { kind: 'accepted', mealPlanId: res.meal_plan_id };
}
