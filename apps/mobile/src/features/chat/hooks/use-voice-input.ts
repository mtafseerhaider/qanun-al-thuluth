import { useMutation } from '@tanstack/react-query';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { track } from '@/lib/analytics/track';

import { transcribeAudio } from '../api/transcribe-api';
import {
  checkVoiceClip,
  clampVoiceDuration,
  voiceProgress,
  VOICE_MAX_MS,
} from '../utils/voice-rules';

/** Mono AAC m4a, 16 kHz is plenty for speech and keeps a 2-minute clip well under 5 MB (12 §15). */
const SPEECH_PRESET = {
  ...RecordingPresets.LOW_QUALITY,
  numberOfChannels: 1,
  sampleRate: 16_000,
  bitRate: 32_000,
};

export type VoiceState = 'idle' | 'denied' | 'recording' | 'transcribing' | 'error';

const bucket = (ms: number) =>
  ms < 10_000 ? 'lt10s' : ms < 30_000 ? '10_30s' : ms < 60_000 ? '30_60s' : '60_120s';

/**
 * Voice input (FR-CHAT-03): record up to 2 minutes (auto-stop at the cap), transcribe with
 * `ai-transcribe`, then hand the transcript to the composer for review. Never sends by itself.
 */
export function useVoiceInput(input: {
  householdId: string | null;
  languageHint: 'en' | 'ur' | 'auto';
  onTranscript: (text: string) => void;
}) {
  const recorder = useAudioRecorder(SPEECH_PRESET);
  const status = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<VoiceState>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const stopping = useRef(false);

  const transcribe = useMutation({
    mutationKey: ['chat', 'transcribe'],
    networkMode: 'online',
    mutationFn: (v: { uri: string; durationMs: number }) =>
      transcribeAudio({
        uri: v.uri,
        meta: {
          household_id: input.householdId as string,
          language_hint: input.languageHint,
          duration_ms: clampVoiceDuration(v.durationMs),
        },
      }),
  });

  const start = useCallback(async () => {
    setProblem(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setState('denied');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    stopping.current = false;
    setState('recording');
  }, [recorder]);

  const finish = useCallback(
    async (discard = false) => {
      if (stopping.current) return;
      stopping.current = true;
      const durationMs = recorder.currentTime * 1000 || status.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (discard || !uri) {
        setState('idle');
        return;
      }
      const issue = checkVoiceClip(durationMs, null);
      if (issue) {
        setProblem(issue);
        setState('idle');
        return;
      }
      setState('transcribing');
      transcribe.mutate(
        { uri, durationMs },
        {
          onSuccess: (r) => {
            track('voice_transcribed', { ok: true, duration_bucket: bucket(durationMs) });
            input.onTranscript(r.text);
            setState('idle');
          },
          onError: () => {
            track('voice_transcribed', { ok: false, duration_bucket: bucket(durationMs) });
            setState('error');
          },
        },
      );
    },
    [recorder, status.durationMillis, transcribe, input],
  );

  // Hard cap: stop at 2 minutes and transcribe what was recorded.
  useEffect(() => {
    if (state === 'recording' && voiceProgress(status.durationMillis).mustStop) void finish();
  }, [state, status.durationMillis, finish]);

  return {
    state,
    problem,
    error: transcribe.error,
    elapsedMs: Math.min(VOICE_MAX_MS, status.durationMillis),
    start,
    stop: () => finish(false),
    cancel: () => finish(true),
  };
}
