import { createSseParser } from '@/lib/sse/sse-parser';

import {
  activeToolDisplay,
  applyChatEvent,
  closeTurn,
  newSentences,
  newTurn,
  parseChatEvent,
  setProposalStatus,
  stopTurn,
  type ChatEvent,
  type ChatTurn,
} from '../utils/chat-stream';
import {
  citationIds,
  stripUnverifiedMarkers,
  visibleCitations,
  type VerifiedRefs,
} from '../utils/citation-rules';
import { canConfirm, guardForMember, proposalAction } from '../utils/proposal-rules';
import { quotaDisplay } from '../utils/quota-rules';
import { emergencyNumbersFor, isUrgent } from '../utils/safety-rules';

const SESSION = '11111111-1111-4111-8111-111111111111';
const USER_MSG = '22222222-2222-4222-8222-222222222222';
const ASSISTANT = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const PLAN = '55555555-5555-4555-8555-555555555555';
const SRC_A = '66666666-6666-4666-8666-666666666666';
const SRC_B = '77777777-7777-4777-8777-777777777777';

/** Feeds a raw SSE transcript through the parser and the reducer, like `streamChat` does. */
function run(wire: string, start: ChatTurn = newTurn({ clientMessageId: 'c1', userText: 'Hi' })) {
  let turn = start;
  const parser = createSseParser((m) => {
    const e = parseChatEvent(m);
    if (e) turn = applyChatEvent(turn, e);
  });
  // Split into small chunks to exercise reassembly.
  for (let i = 0; i < wire.length; i += 7) parser.push(wire.slice(i, i + 7));
  parser.end();
  return turn;
}

const sse = (id: number, type: string, data: unknown) =>
  `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const START = sse(1, 'message.start', {
  session_id: SESSION,
  user_message_id: USER_MSG,
  assistant_message_id: ASSISTANT,
  model_route: 'chat.default',
  quota: { limit: 20, remaining: 12 },
});

describe('streaming bubble assembly', () => {
  it('assembles deltas, tools, citations, follow-ups and done into one turn', () => {
    const turn = run(
      START +
        sse(2, 'tool.call', {
          tool_call_id: 't1',
          name: 'get_household_snapshot',
          display: 'Checking your family',
        }) +
        ': ping\n\n' +
        sse(3, 'tool.result', { tool_call_id: 't1', name: 'get_household_snapshot', ok: true }) +
        sse(4, 'message.delta', { text: 'Dates and water [1] ' }) +
        sse(5, 'message.delta', { text: 'are a gentle start.' }) +
        sse(6, 'citation', { kind: 'islamic_source', ref_id: SRC_A, label: 'Hadith', marker: 1 }) +
        sse(7, 'follow_up', { suggestions: ['What about suhoor?'] }) +
        sse(8, 'done', { assistant_message_id: ASSISTANT, finish_reason: 'complete' }),
    );
    expect(turn.status).toBe('done');
    expect(turn.sessionId).toBe(SESSION);
    expect(turn.quota).toEqual({ limit: 20, remaining: 12 });
    expect(turn.text).toBe('Dates and water [1] are a gentle start.');
    expect(turn.tools).toEqual([
      expect.objectContaining({ id: 't1', ok: true, display: 'Checking your family' }),
    ]);
    expect(turn.citations).toHaveLength(1);
    expect(turn.followUps).toEqual(['What about suhoor?']);
    expect(turn.finishReason).toBe('complete');
  });

  it('drops unknown or malformed events instead of throwing', () => {
    const turn = run(
      START +
        'event: message.delta\ndata: {not json}\n\n' +
        sse(3, 'surprise', { x: 1 }) +
        sse(4, 'message.delta', { text: 'ok' }),
    );
    expect(turn.text).toBe('ok');
    expect(turn.status).toBe('streaming');
  });

  it('shows the running tool line until its result arrives', () => {
    let turn = run(
      START +
        sse(2, 'tool.call', { tool_call_id: 't1', name: 'search_meals', display: 'Finding meals' }),
    );
    expect(activeToolDisplay(turn)).toBe('Finding meals');
    turn = applyChatEvent(turn, {
      type: 'tool.result',
      data: { tool_call_id: 't1', name: 'search_meals', ok: true },
    } as ChatEvent);
    expect(activeToolDisplay(turn)).toBeNull();
  });

  it('keeps partial text when stopped and ignores late events', () => {
    let turn = run(START + sse(2, 'message.delta', { text: 'Partial' }));
    turn = stopTurn(turn);
    turn = applyChatEvent(turn, { type: 'message.delta', data: { text: ' more' } });
    expect(turn.status).toBe('stopped');
    expect(turn.text).toBe('Partial');
  });

  it('marks a stream that closes without done as a retryable network error', () => {
    const turn = closeTurn(run(START + sse(2, 'message.delta', { text: 'x' })));
    expect(turn.status).toBe('error');
    expect(turn.error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('keeps an escalation over a later notice', () => {
    const turn = run(
      START +
        sse(2, 'safety', {
          action: 'escalate',
          escalation: {
            reason: 'dehydration_signs',
            family_member_id: null,
            message: 'Get help',
            recommend: 'emergency',
          },
        }) +
        sse(3, 'safety', { action: 'notice', notice_key: 'safety.notice.not_medical_advice' }),
    );
    expect(turn.safety?.action).toBe('escalate');
  });

  it('announces whole sentences only', () => {
    expect(newSentences('One. Two', 0)).toEqual({ sentences: 'One.', nextLength: 4 });
    expect(newSentences('One. Two', 4)).toEqual({ sentences: '', nextLength: 4 });
  });
});

describe('tool confirmation never auto-applies', () => {
  const proposalWire =
    START +
    sse(2, 'tool.result', {
      tool_call_id: 'p1',
      name: 'log_meal',
      ok: true,
      card: {
        kind: 'log_proposal',
        table: 'hydration_logs',
        values: { family_member_id: MEMBER, volume_ml: 250 },
      },
    }) +
    sse(3, 'tool.result', {
      tool_call_id: 'p2',
      name: 'adjust_meal_plan',
      ok: true,
      card: {
        kind: 'plan_adjustment_proposal',
        meal_plan_id: PLAN,
        change_request: 'Lighter dinners',
        scope_summary: 'Dinners this week',
      },
    }) +
    sse(4, 'done', { assistant_message_id: ASSISTANT, finish_reason: 'complete' });

  it('records every proposal as pending, even after the stream completes', () => {
    const turn = run(proposalWire);
    expect(turn.status).toBe('done');
    expect(turn.proposals.map((p) => [p.id, p.status])).toEqual([
      ['p1', 'pending'],
      ['p2', 'pending'],
    ]);
  });

  it('does not duplicate a replayed proposal', () => {
    const turn = run(
      proposalWire.replace(
        sse(4, 'done', { assistant_message_id: ASSISTANT, finish_reason: 'complete' }),
        '',
      ) +
        sse(5, 'tool.result', {
          tool_call_id: 'p1',
          name: 'log_meal',
          ok: true,
          card: {
            kind: 'log_proposal',
            table: 'hydration_logs',
            values: { family_member_id: MEMBER, volume_ml: 250 },
          },
        }),
    );
    expect(turn.proposals).toHaveLength(2);
  });

  it('accepts proposals from the log_hydration and log_fasting tools as pending', () => {
    const turn = run(
      START +
        sse(2, 'tool.result', {
          tool_call_id: 'h1',
          name: 'log_hydration',
          ok: true,
          card: {
            kind: 'log_proposal',
            table: 'hydration_logs',
            values: { family_member_id: MEMBER, volume_ml: 300 },
          },
        }) +
        sse(3, 'tool.result', {
          tool_call_id: 'f1',
          name: 'log_fasting',
          ok: true,
          card: {
            kind: 'log_proposal',
            table: 'fasting_logs',
            values: { family_member_id: MEMBER, fast_date: '2027-02-10', kind: 'ramadan' },
          },
        }),
    );
    expect(turn.proposals.map((p) => [p.id, p.status])).toEqual([
      ['h1', 'pending'],
      ['f1', 'pending'],
    ]);
  });

  it('ignores cards on failed tool results', () => {
    const turn = run(
      START +
        sse(2, 'tool.result', {
          tool_call_id: 'p1',
          name: 'log_meal',
          ok: false,
          card: { kind: 'log_proposal', table: 'hydration_logs', values: {} },
        }),
    );
    expect(turn.proposals).toEqual([]);
  });

  it('changes state only through setProposalStatus (the Confirm button)', () => {
    const turn = run(proposalWire);
    const after = setProposalStatus(turn, 'p1', 'applied');
    expect(after.proposals[0]?.status).toBe('applied');
    expect(after.proposals[1]?.status).toBe('pending');
    expect(turn.proposals[0]?.status).toBe('pending');
  });

  it('turns cards into validated actions and only offers Confirm while pending', () => {
    const turn = run(proposalWire);
    const [p1, p2] = turn.proposals;
    if (!p1 || !p2) throw new Error('missing proposals');
    const a1 = proposalAction(p1.card);
    expect(a1).toMatchObject({
      kind: 'hydration',
      memberId: MEMBER,
      volumeMl: 250,
      beverage: 'water',
    });
    expect(proposalAction(p2.card)).toMatchObject({ kind: 'plan_adjust', mealPlanId: PLAN });
    expect(canConfirm(p1, a1, true)).toBe(true);
    expect(canConfirm(p1, a1, false)).toBe(false);
    expect(canConfirm({ ...p1, status: 'dismissed' }, a1, true)).toBe(false);
  });

  it('refuses malformed values and unsupported tables', () => {
    expect(
      proposalAction({
        kind: 'log_proposal',
        table: 'hydration_logs',
        values: { volume_ml: 'lots' },
      }),
    ).toEqual({ kind: 'unsupported', reason: 'invalid' });
    expect(proposalAction({ kind: 'log_proposal', table: 'food_exposures', values: {} })).toEqual({
      kind: 'unsupported',
      reason: 'not_available',
    });
  });

  it('applies child rules: no fullness for minors, no fasts under 7, practice under 13', () => {
    const meal = proposalAction({
      kind: 'log_proposal',
      table: 'meal_logs',
      values: {
        family_member_id: MEMBER,
        meal_type: 'lunch',
        description: 'Daal chawal',
        fullness_after: 4,
      },
    });
    expect(guardForMember(meal, { ageYears: 9, minor: true })).toMatchObject({
      fullnessAfter: null,
    });
    const fast = proposalAction({
      kind: 'log_proposal',
      table: 'fasting_logs',
      values: { family_member_id: MEMBER, fast_date: '2027-02-10', kind: 'ramadan' },
    });
    expect(guardForMember(fast, { ageYears: 5, minor: true })).toEqual({
      kind: 'unsupported',
      reason: 'invalid',
    });
    expect(guardForMember(fast, { ageYears: 10, minor: true })).toMatchObject({ practice: true });
    expect(guardForMember(fast, { ageYears: 30, minor: false })).toMatchObject({ practice: false });
  });
});

describe('citation filtering', () => {
  const cites = [
    { kind: 'islamic_source' as const, ref_id: SRC_B, label: 'B', marker: 2 },
    { kind: 'islamic_source' as const, ref_id: SRC_A, label: 'A', marker: 1 },
    { kind: 'islamic_source' as const, ref_id: SRC_A, label: 'A again', marker: 3 },
    { kind: 'recommendation' as const, ref_id: SRC_B, label: 'R', marker: 4 },
  ];
  const verified: VerifiedRefs = {
    islamicSources: new Set([SRC_A]),
    recommendations: new Set(),
    evidence: new Set(),
  };

  it('shows only verified sources, one chip each, ordered by marker', () => {
    expect(visibleCitations(cites, verified).map((c) => c.marker)).toEqual([1]);
  });

  it('shows nothing while verification has not loaded', () => {
    const none = {
      islamicSources: new Set<string>(),
      recommendations: new Set<string>(),
      evidence: new Set<string>(),
    };
    expect(visibleCitations(cites, none)).toEqual([]);
  });

  it('strips markers of hidden citations from the text', () => {
    expect(stripUnverifiedMarkers('Dates [1] and water [2] help [4].', new Set([1]))).toBe(
      'Dates [1] and water help.',
    );
  });

  it('groups ids to verify by kind without duplicates', () => {
    expect(citationIds(cites)).toEqual({
      islamicSources: [SRC_B, SRC_A],
      recommendations: [SRC_B],
      evidence: [],
    });
  });
});

describe('quota and safety', () => {
  it('shows a counter only near the free limit and never for premium', () => {
    expect(quotaDisplay({ limit: 20, remaining: 12 }, false).kind).toBe('hidden');
    expect(quotaDisplay({ limit: 20, remaining: 3 }, false)).toMatchObject({
      kind: 'counter',
      remaining: 3,
    });
    expect(quotaDisplay({ limit: 20, remaining: 0 }, false).kind).toBe('reached');
    expect(quotaDisplay({ limit: 200, remaining: 3 }, true).kind).toBe('hidden');
  });

  it('lists local emergency numbers and treats emergencies as urgent', () => {
    expect(emergencyNumbersFor('PK').map((n) => n.number)).toEqual(['1122', '115']);
    expect(emergencyNumbersFor('gb')[0]?.number).toBe('999');
    expect(emergencyNumbersFor('ZZ')).toEqual([]);
    expect(isUrgent('emergency')).toBe(true);
    expect(isUrgent('see_gp')).toBe(false);
  });
});
