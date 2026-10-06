import {
  DEFAULT_POLL_MS,
  failureCode,
  outcomeFor,
  pollIntervalFor,
  stageFor,
} from '../utils/generation-rules';

const progress = (
  phase: 'queued' | 'safety_check' | 'generating' | 'validating' | 'writing' | 'done' | 'failed',
  completed = 0,
) => ({
  phase,
  completed_weeks: completed,
  total_weeks: 1,
  attempt: 1,
});

describe('plan generation rules (24 S3-07)', () => {
  it('maps server phases to calm UI stages', () => {
    expect(stageFor(null)).toEqual({ stage: 'reading', percent: 10 });
    expect(stageFor(progress('queued')).stage).toBe('reading');
    expect(stageFor(progress('safety_check')).stage).toBe('targets');
    expect(stageFor(progress('generating')).stage).toBe('choosing');
    expect(stageFor(progress('generating', 1)).stage).toBe('adapting');
    expect(stageFor(progress('validating')).stage).toBe('checking');
    expect(stageFor(progress('writing'))).toEqual({ stage: 'saving', percent: 100 });
  });

  it('treats draft and active as ready, failed and archived as failed', () => {
    expect(outcomeFor('generating')).toBe('generating');
    expect(outcomeFor(undefined)).toBe('generating');
    expect(outcomeFor('draft')).toBe('ready');
    expect(outcomeFor('active')).toBe('ready');
    expect(outcomeFor('failed')).toBe('failed');
  });

  it('polls at poll_after_ms when Realtime is not connected (fallback)', () => {
    expect(
      pollIntervalFor({ status: 'generating', realtime: 'connecting', pollAfterMs: 2500 }),
    ).toBe(2500);
    expect(pollIntervalFor({ status: 'generating', realtime: 'error', pollAfterMs: 2500 })).toBe(
      2500,
    );
    expect(pollIntervalFor({ status: 'generating', realtime: 'closed', pollAfterMs: null })).toBe(
      DEFAULT_POLL_MS,
    );
  });

  it('polls slowly as a safety net while Realtime is subscribed, and stops when final', () => {
    expect(
      pollIntervalFor({ status: 'generating', realtime: 'subscribed', pollAfterMs: 2500 }),
    ).toBe(12_500);
    expect(
      pollIntervalFor({ status: 'generating', realtime: 'subscribed', pollAfterMs: 1000 }),
    ).toBe(10_000);
    expect(pollIntervalFor({ status: 'draft', realtime: 'error', pollAfterMs: 2500 })).toBe(false);
    expect(pollIntervalFor({ status: 'failed', realtime: 'subscribed', pollAfterMs: 2500 })).toBe(
      false,
    );
  });

  it('reports the failure code from generation_progress', () => {
    expect(failureCode({ ...progress('failed'), error_code: 'AI_TIMEOUT' })).toBe('AI_TIMEOUT');
    expect(failureCode(null)).toBe('INTERNAL');
  });
});
