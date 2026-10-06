/**
 * Email OTP rules (11 §3.1) as pure functions over `OtpFlowState`, so the limits are unit-tested and
 * the store stays thin. Server limits stay authoritative; these keep the UI honest.
 */
export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_MS = 60_000;
export const SEND_WINDOW_MS = 30 * 60_000;
export const MAX_SENDS_PER_WINDOW = 5;
export const MAX_WRONG_ATTEMPTS = 5;

export type OtpStatus = 'idle' | 'code_sent' | 'locked';

export interface OtpFlowState {
  email: string;
  sentAt: number | null;
  resendAvailableAt: number | null;
  sendsInWindow: number[];
  wrongAttempts: number;
  status: OtpStatus;
}

export const initialOtpFlow: OtpFlowState = {
  email: '',
  sentAt: null,
  resendAvailableAt: null,
  sendsInWindow: [],
  wrongAttempts: 0,
  status: 'idle',
};

export type SendCheck =
  { ok: true } | { ok: false; reason: 'cooldown' | 'window'; retryAt: number };

const pruned = (sends: number[], now: number) => sends.filter((t) => now - t < SEND_WINDOW_MS);

/** Whether another code may be requested for `email` now. A different email resets the cooldown. */
export function canSendCode(state: OtpFlowState, email: string, now: number): SendCheck {
  const sends = pruned(state.sendsInWindow, now);
  if (sends.length >= MAX_SENDS_PER_WINDOW) {
    return { ok: false, reason: 'window', retryAt: Math.min(...sends) + SEND_WINDOW_MS };
  }
  if (email === state.email && state.resendAvailableAt !== null && now < state.resendAvailableAt) {
    return { ok: false, reason: 'cooldown', retryAt: state.resendAvailableAt };
  }
  return { ok: true };
}

export function codeSent(state: OtpFlowState, email: string, now: number): OtpFlowState {
  return {
    email,
    sentAt: now,
    resendAvailableAt: now + RESEND_COOLDOWN_MS,
    sendsInWindow: [...pruned(state.sendsInWindow, now), now],
    wrongAttempts: 0,
    status: 'code_sent',
  };
}

/** After the fifth wrong code for one sent code the input locks until a resend (11 §3.1). */
export function wrongCode(state: OtpFlowState): OtpFlowState {
  const wrongAttempts = state.wrongAttempts + 1;
  return {
    ...state,
    wrongAttempts,
    status: wrongAttempts >= MAX_WRONG_ATTEMPTS ? 'locked' : state.status,
  };
}

/** An expired code: resend becomes available immediately (02 §5.1). */
export function codeExpired(state: OtpFlowState, now: number): OtpFlowState {
  return { ...state, resendAvailableAt: now };
}

export function attemptsLeft(state: OtpFlowState): number {
  return Math.max(0, MAX_WRONG_ATTEMPTS - state.wrongAttempts);
}

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/**
 * Normalises typed, pasted or autofilled input: Urdu/Arabic-Indic digits become Western digits,
 * everything else (spaces, dashes, "Your code is") is dropped, and the result is capped at 6 digits.
 */
export function sanitizeOtp(text: string): string {
  return text
    .replace(ARABIC_INDIC, (d) => String(((d.charCodeAt(0) - 0x0660) % 0x90) % 10))
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH);
}

/** `a••••@gmail.com`: first character of the local part, then dots (02 §7.1.4). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email[0]}${'•'.repeat(Math.max(1, Math.min(4, at - 1)))}${email.slice(at)}`;
}
