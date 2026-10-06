import {
  attemptsLeft,
  canSendCode,
  codeExpired,
  codeSent,
  initialOtpFlow,
  MAX_SENDS_PER_WINDOW,
  maskEmail,
  RESEND_COOLDOWN_MS,
  sanitizeOtp,
  SEND_WINDOW_MS,
  wrongCode,
} from '../utils/otp-flow';

const T0 = 1_800_000_000_000;

describe('sanitizeOtp', () => {
  it('keeps digits from pasted messages and caps at six', () => {
    expect(sanitizeOtp('Your code is 123 456.')).toBe('123456');
    expect(sanitizeOtp('123-456-789')).toBe('123456');
  });

  it('converts Arabic-Indic and Extended Arabic-Indic (Urdu) digits', () => {
    expect(sanitizeOtp('١٢٣٤٥٦')).toBe('123456');
    expect(sanitizeOtp('۰۱۲۳۴۵')).toBe('012345');
  });
});

describe('resend cooldown and send window', () => {
  it('blocks a resend for the same email until the cooldown passes', () => {
    const sent = codeSent(initialOtpFlow, 'a@b.co', T0);
    expect(canSendCode(sent, 'a@b.co', T0 + 1000)).toEqual({
      ok: false,
      reason: 'cooldown',
      retryAt: T0 + RESEND_COOLDOWN_MS,
    });
    expect(canSendCode(sent, 'a@b.co', T0 + RESEND_COOLDOWN_MS)).toEqual({ ok: true });
    expect(canSendCode(sent, 'other@b.co', T0 + 1000)).toEqual({ ok: true });
  });

  it('caps sends per 30-minute window', () => {
    let s = initialOtpFlow;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++)
      s = codeSent(s, 'a@b.co', T0 + i * RESEND_COOLDOWN_MS);
    const now = T0 + MAX_SENDS_PER_WINDOW * RESEND_COOLDOWN_MS;
    expect(canSendCode(s, 'a@b.co', now)).toEqual({
      ok: false,
      reason: 'window',
      retryAt: T0 + SEND_WINDOW_MS,
    });
    expect(canSendCode(s, 'a@b.co', T0 + SEND_WINDOW_MS)).toEqual({ ok: true });
  });

  it('makes resend available immediately once the code expires', () => {
    const s = codeExpired(codeSent(initialOtpFlow, 'a@b.co', T0), T0 + 5000);
    expect(canSendCode(s, 'a@b.co', T0 + 5000)).toEqual({ ok: true });
  });
});

describe('wrong attempts', () => {
  it('locks after five wrong codes and a new code resets the count', () => {
    let s = codeSent(initialOtpFlow, 'a@b.co', T0);
    for (let i = 0; i < 4; i++) s = wrongCode(s);
    expect(s.status).toBe('code_sent');
    expect(attemptsLeft(s)).toBe(1);
    s = wrongCode(s);
    expect(s.status).toBe('locked');
    expect(attemptsLeft(s)).toBe(0);
    s = codeSent(s, 'a@b.co', T0 + RESEND_COOLDOWN_MS);
    expect(s.status).toBe('code_sent');
    expect(s.wrongAttempts).toBe(0);
  });
});

it('masks the email for the OTP screen', () => {
  expect(maskEmail('amina@gmail.com')).toBe('a••••@gmail.com');
  expect(maskEmail('ab@x.pk')).toBe('a•@x.pk');
});
