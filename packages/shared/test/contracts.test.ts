import { describe, expect, it } from 'vitest';

import { ERROR_HTTP_STATUS, ErrorCode, ErrorEnvelope } from '../src/contracts/index.ts';
import { formatMinor, toMinor } from '../src/utils/money.ts';

describe('ErrorEnvelope', () => {
  it('defaults details to an empty object', () => {
    const parsed = ErrorEnvelope.parse({ error: { code: 'NOT_FOUND', message: 'Missing' } });
    expect(parsed.error.details).toEqual({});
  });

  it('rejects unknown codes', () => {
    expect(ErrorEnvelope.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });

  it('has an HTTP status for every code', () => {
    for (const code of ErrorCode.options)
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});

describe('money', () => {
  it('formats minor units', () => {
    expect(formatMinor(4500000, 'PKR', 'en')).toBe('PKR 45,000');
    expect(toMinor(450.5, 'PKR')).toBe(45050);
  });
});

describe('plan contracts', () => {
  it('applies generate-plan defaults and rejects ramadan', async () => {
    const { AiGeneratePlanRequest } = await import('../src/contracts/ai-generate-plan.ts');
    const base = { household_id: '00000000-0000-4000-8000-000000000001', start_date: '2026-10-12' };
    const p = AiGeneratePlanRequest.parse(base);
    expect(p.week_count).toBe(1);
    expect(p.meal_types).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(p.preferences.sunnah_foods_emphasis).toBe(true);
    expect(AiGeneratePlanRequest.safeParse({ ...base, kind: 'ramadan' }).success).toBe(false);
  });

  it('rejects an adjust scope that ends before it starts', async () => {
    const { AiAdjustPlanRequest } = await import('../src/contracts/ai-adjust-plan.ts');
    const r = AiAdjustPlanRequest.safeParse({
      meal_plan_id: '00000000-0000-4000-8000-000000000001',
      change_request: 'less rice',
      scope: { from_date: '2026-10-14', to_date: '2026-10-13' },
    });
    expect(r.success).toBe(false);
  });
});

describe('sprint 5 contracts', () => {
  it('parses chat SSE events and rejects unknown tools', async () => {
    const { ChatSseEvent } = await import('../src/contracts/ai-chat.ts');
    expect(ChatSseEvent.parse({ type: 'message.delta', data: { text: 'Salaam' } }).type).toBe(
      'message.delta',
    );
    expect(
      ChatSseEvent.safeParse({
        type: 'tool.call',
        data: { tool_call_id: 't1', name: 'delete_household', display: 'x' },
      }).success,
    ).toBe(false);
  });

  it('requires practice-fast details and exemption reasons', async () => {
    const { RamadanParticipant } = await import('../src/contracts/ramadan-generate.ts');
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      RamadanParticipant.safeParse({ family_member_id: id, intention: 'practice_fast' }).success,
    ).toBe(false);
    expect(
      RamadanParticipant.safeParse({ family_member_id: id, intention: 'exempt' }).success,
    ).toBe(false);
    expect(
      RamadanParticipant.safeParse({
        family_member_id: id,
        intention: 'exempt',
        exemption_reason: 'breastfeeding',
      }).success,
    ).toBe(true);
  });
});
