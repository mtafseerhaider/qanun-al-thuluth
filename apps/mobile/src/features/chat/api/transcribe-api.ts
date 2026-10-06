import { AiTranscribeMeta, AiTranscribeResponse } from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { edgeErrorFrom, edgeRequestInit } from '@/lib/supabase/edge';

/**
 * `ai-transcribe` (06 §4.6): multipart with `audio` (the m4a file) and `meta` (JSON). Premium;
 * the server answers `PREMIUM_REQUIRED` for free users, which the UI shows as the voice paywall.
 * Audio is held in memory server-side and never stored.
 */
export async function transcribeAudio(
  input: { uri: string; meta: AiTranscribeMeta },
  fetchImpl: typeof fetch = fetch,
): Promise<AiTranscribeResponse> {
  const meta = AiTranscribeMeta.parse(input.meta);
  const { url, headers } = await edgeRequestInit('ai-transcribe');
  const form = new FormData();
  // React Native's FormData accepts a file descriptor object for local URIs.
  form.append('audio', { uri: input.uri, name: 'voice.m4a', type: 'audio/m4a' } as unknown as Blob);
  form.append('meta', JSON.stringify(meta));
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: form });
  } catch (error) {
    throw new AppError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network request failed.',
    );
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw edgeErrorFrom('ai-transcribe', res.status, json);
  const parsed = AiTranscribeResponse.safeParse(json);
  if (!parsed.success)
    throw new AppError('INVALID_RESPONSE', 'ai-transcribe returned an unexpected shape.');
  return parsed.data;
}
