import { describe, expect, it } from 'vitest';

import {
  AiSmokeRequest,
  ERROR_HTTP_STATUS,
  ErrorCode,
  ErrorEnvelope,
} from '../src/contracts/index.ts';
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

describe('AiSmokeRequest', () => {
  it('trims and bounds the prompt', () => {
    expect(AiSmokeRequest.safeParse({ prompt: '   ' }).success).toBe(false);
    expect(AiSmokeRequest.safeParse({ prompt: 'x'.repeat(501) }).success).toBe(false);
    expect(AiSmokeRequest.parse({ prompt: ' salaam ' }).prompt).toBe('salaam');
  });
});

describe('money', () => {
  it('formats minor units', () => {
    expect(formatMinor(4500000, 'PKR', 'en')).toBe('PKR 45,000');
    expect(toMinor(450.5, 'PKR')).toBe(45050);
  });
});
