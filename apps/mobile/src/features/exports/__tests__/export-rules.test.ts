import { AppError } from '@/lib/supabase/app-error';

import {
  displayStatus,
  exportBaseName,
  exportProblem,
  needsChildDataConfirm,
  pollDelays,
} from '../utils/export-rules';

const NOW = Date.parse('2026-10-06T12:00:00Z');

describe('export rules', () => {
  it('treats a disabled renderer as "not available yet", not an error', () => {
    expect(
      exportProblem(
        new AppError('FEATURE_DISABLED', 'x', { details: { reason: 'renderer_not_configured' } }),
      ),
    ).toBe('not_available');
    expect(exportProblem(new AppError('PREMIUM_REQUIRED', 'x'))).toBe('premium');
    expect(exportProblem(new AppError('EXPORT_KIND_UNSUPPORTED', 'x'))).toBe('unsupported');
    expect(exportProblem(new AppError('IDEMPOTENCY_IN_PROGRESS', 'x'))).toBe('busy');
    expect(exportProblem(new AppError('NETWORK_ERROR', 'x'))).toBe('offline');
    expect(
      exportProblem(new AppError('CONFLICT', 'x', { details: { export_status: 'expired' } })),
    ).toBe('expired');
    expect(exportProblem(new AppError('UPSTREAM_UNAVAILABLE', 'x'))).toBe('failed');
    expect(exportProblem('boom')).toBe('generic');
  });

  it('expires ready links after their 24 h window', () => {
    expect(displayStatus('ready', '2026-10-07T12:00:00Z', NOW)).toBe('ready');
    expect(displayStatus('ready', '2026-10-06T11:59:59Z', NOW)).toBe('expired');
    expect(displayStatus('queued', '2026-10-07T12:00:00Z', NOW)).toBe('processing');
    expect(displayStatus('failed', '2026-10-07T12:00:00Z', NOW)).toBe('failed');
  });

  it('names files and asks before sharing a child growth report', () => {
    expect(exportBaseName('meal_plan', '2026-10-06')).toBe('thuluth-meal-plan-2026-10-06');
    expect(needsChildDataConfirm('growth_report')).toBe(true);
    expect(needsChildDataConfirm('grocery_list')).toBe(false);
  });

  it('backs off polling between 2 and 5 seconds within 90 seconds', () => {
    const delays = pollDelays(1000);
    expect(delays[0]).toBe(1000);
    expect(delays.slice(1).every((d) => d >= 2000 && d <= 5000)).toBe(true);
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(90_000);
    expect(pollDelays(60_000)[0]).toBe(5000);
  });
});
