import { TRANSCRIBE_MAX_BYTES } from '@shared/contracts';

import {
  checkVoiceClip,
  clampVoiceDuration,
  formatClock,
  isRtlText,
  languageHint,
  mergeTranscript,
  VOICE_MAX_MS,
  voiceProgress,
} from '../utils/voice-rules';

describe('voice length cap', () => {
  it('caps recordings at two minutes', () => {
    expect(VOICE_MAX_MS).toBe(120_000);
    expect(voiceProgress(119_999).mustStop).toBe(false);
    expect(voiceProgress(120_000)).toMatchObject({ mustStop: true, remainingMs: 0, fraction: 1 });
    expect(voiceProgress(150_000).remainingMs).toBe(0);
  });

  it('never reports a duration above the cap', () => {
    expect(clampVoiceDuration(125_400)).toBe(VOICE_MAX_MS);
    expect(clampVoiceDuration(-5)).toBe(0);
    expect(clampVoiceDuration(1234.6)).toBe(1235);
  });

  it('rejects accidental taps and oversize files', () => {
    expect(checkVoiceClip(300, 1000)).toBe('too_short');
    expect(checkVoiceClip(5000, TRANSCRIBE_MAX_BYTES + 1)).toBe('too_large');
    expect(checkVoiceClip(5000, null)).toBeNull();
  });

  it('formats the timer with Western digits', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(VOICE_MAX_MS)).toBe('2:00');
  });
});

describe('transcript review', () => {
  it('appends the transcript to the draft for editing, never replacing typed text', () => {
    expect(mergeTranscript('Also', ' what about iftar? ')).toBe('Also what about iftar?');
    expect(mergeTranscript('', 'hello')).toBe('hello');
    expect(mergeTranscript('kept', '   ')).toBe('kept');
    expect(mergeTranscript('', 'x'.repeat(5000))).toHaveLength(4000);
  });

  it('picks the language hint and text direction', () => {
    expect(languageHint('ur-PK')).toBe('ur');
    expect(languageHint('en')).toBe('en');
    expect(languageHint('fr')).toBe('auto');
    expect(isRtlText('سحری میں کیا کھائیں')).toBe(true);
    expect(isRtlText('What about suhoor?')).toBe(false);
  });
});
