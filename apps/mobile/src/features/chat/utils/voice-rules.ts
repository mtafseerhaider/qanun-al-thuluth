import { TRANSCRIBE_MAX_BYTES } from '@shared/contracts';

/**
 * Voice input rules (FR-CHAT-03, 02 §7.7.2, 06 §4.6): record at most 2 minutes, upload to
 * `ai-transcribe`, and place the transcript in the composer for review; never auto-send.
 */
export const VOICE_MAX_MS = 120_000;
/** Clips shorter than this are discarded as accidental taps. */
export const VOICE_MIN_MS = 700;

/** Remaining time and whether the recorder must stop now. */
export function voiceProgress(elapsedMs: number): {
  remainingMs: number;
  mustStop: boolean;
  fraction: number;
} {
  const e = Math.max(0, elapsedMs);
  return {
    remainingMs: Math.max(0, VOICE_MAX_MS - e),
    mustStop: e >= VOICE_MAX_MS,
    fraction: Math.min(1, e / VOICE_MAX_MS),
  };
}

/** The duration sent in `meta.duration_ms`: never above the cap the contract accepts. */
export function clampVoiceDuration(ms: number): number {
  return Math.max(0, Math.min(VOICE_MAX_MS, Math.round(ms)));
}

export type VoiceClipProblem = 'too_short' | 'too_large' | null;

export function checkVoiceClip(durationMs: number, bytes: number | null): VoiceClipProblem {
  if (durationMs < VOICE_MIN_MS) return 'too_short';
  if (bytes !== null && bytes > TRANSCRIBE_MAX_BYTES) return 'too_large';
  return null;
}

/** Language hint from the UI locale (Urdu speech often mixes in English; the hint is advisory). */
export function languageHint(locale: string): 'en' | 'ur' | 'auto' {
  if (locale.startsWith('ur')) return 'ur';
  if (locale.startsWith('en')) return 'en';
  return 'auto';
}

/** Merges a transcript into an existing draft (the user may have typed something already). */
export function mergeTranscript(draft: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return draft;
  const d = draft.trimEnd();
  return (d ? `${d} ${t}` : t).slice(0, 4000);
}

/** Direction for the transcript field: Urdu and Arabic script render right to left. */
export function isRtlText(text: string): boolean {
  const rtl = (text.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return rtl > latin;
}

export function formatClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
