import { AIError, transcribeMetered } from '@thuluth/ai-core';
import type { AiUsageInsert, FallbackDeps } from '@thuluth/ai-core';
import {
  AiTranscribeMeta,
  AiTranscribeResponse,
  TRANSCRIBE_MAX_BYTES,
  TRANSCRIBE_MIME_TYPES,
} from '@thuluth/shared/contracts/ai-transcribe.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { consumeTierQuota, requirePremium, resolveEntitlement } from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';
import { errorResponse, HttpError } from '../_shared/errors.ts';
import { requestIdOf } from '../_shared/http.ts';
import type { PlatformStore } from '../_shared/platform.ts';

export const SCOPE = 'ai-transcribe';
/** iOS reports AAC-in-MP4 recordings as `audio/x-m4a`; it is the same container as `audio/m4a`. */
const MIME_ALIASES: Record<string, string> = { 'audio/x-m4a': 'audio/m4a' };

export interface TranscribeDeps {
  verify: ClaimsVerifier;
  platform: Pick<PlatformStore, 'membership' | 'featureEnabled' | 'consumeRateLimit'>;
  entitlements: Pick<EntitlementStore, 'userPremium' | 'householdPremium'>;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
}

/**
 * `ai-transcribe` (06 §4.6, 12 §15): multipart `audio` + `meta`. Premium, at most 2 minutes and
 * 5 MB. The audio is held in memory only and never stored; the provider sits behind
 * `AIProvider.transcribe` (route `speech.transcribe`).
 */
export function createTranscribeHandler(deps: TranscribeDeps) {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdOf(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      if (req.method !== 'POST') throw new HttpError('NOT_FOUND', 'Not found');
      const user = await requireUser(req, deps.verify);
      const declared = Number(req.headers.get('content-length') ?? '0');
      // Multipart overhead is small; anything far beyond the audio limit is refused unread.
      if (declared > TRANSCRIBE_MAX_BYTES + 64 * 1024) {
        throw new HttpError('PAYLOAD_TOO_LARGE', 'The recording is too large (5 MB at most).', {
          max_bytes: TRANSCRIBE_MAX_BYTES,
        });
      }
      if (
        !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')
      ) {
        throw new HttpError('UNSUPPORTED_MEDIA_TYPE', 'Send the recording as multipart/form-data.');
      }
      const form = await req.formData().catch(() => {
        throw new HttpError('VALIDATION_FAILED', 'The form data could not be read.');
      });
      const metaRaw = form.get('meta');
      let metaJson: unknown;
      try {
        metaJson = JSON.parse(typeof metaRaw === 'string' ? metaRaw : '');
      } catch {
        throw new HttpError('VALIDATION_FAILED', 'The meta field must be JSON.', { field: 'meta' });
      }
      const parsed = AiTranscribeMeta.safeParse(metaJson);
      if (!parsed.success) {
        const tooLong = parsed.error.issues.some(
          (i) => i.path[0] === 'duration_ms' && i.code === 'too_big',
        );
        if (tooLong) {
          throw new HttpError('PAYLOAD_TOO_LARGE', 'Recordings can be up to 2 minutes.', {
            max_duration_ms: 120_000,
          });
        }
        throw new HttpError('VALIDATION_FAILED', 'Request is invalid', {
          issues: parsed.error.issues,
        });
      }
      const meta = parsed.data;
      const audio = form.get('audio');
      if (!audio || typeof audio === 'string') {
        throw new HttpError('VALIDATION_FAILED', 'The audio file is missing.', { field: 'audio' });
      }
      const rawType = (audio.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
      const mime = MIME_ALIASES[rawType] ?? rawType;
      if (!(TRANSCRIBE_MIME_TYPES as readonly string[]).includes(mime)) {
        throw new HttpError('UNSUPPORTED_MEDIA_TYPE', 'This audio format is not supported.', {
          accepted: TRANSCRIBE_MIME_TYPES,
        });
      }
      if (audio.size > TRANSCRIBE_MAX_BYTES) {
        throw new HttpError('PAYLOAD_TOO_LARGE', 'The recording is too large (5 MB at most).', {
          max_bytes: TRANSCRIBE_MAX_BYTES,
        });
      }
      if (audio.size === 0 || meta.duration_ms <= 0) {
        throw new HttpError('VALIDATION_FAILED', 'The recording is empty.', { field: 'audio' });
      }

      const role = await deps.platform.membership(meta.household_id, user.userId);
      if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
      const ent = await resolveEntitlement(deps.entitlements, {
        userId: user.userId,
        householdId: meta.household_id,
        scope: 'household_or_personal',
      });
      requirePremium(ent, 'chat.voice', 'Voice messages need Premium.');
      if (!(await deps.platform.featureEnabled('ai.voice.enabled'))) {
        throw new HttpError('FEATURE_DISABLED', 'Voice input is paused right now.', {
          flag: 'ai.voice.enabled',
        });
      }
      const headers = {
        ...corsHeaders,
        'x-request-id': requestId,
        ...(await consumeTierQuota(deps.platform, SCOPE, user.userId, ent.tier)),
      };

      let result;
      try {
        result = await transcribeMetered({
          audio: new Uint8Array(await audio.arrayBuffer()),
          mimeType: mime,
          languageHint: meta.language_hint === 'auto' ? undefined : meta.language_hint,
          durationSec: meta.duration_ms / 1000,
          metadata: {
            requestId,
            userId: user.userId,
            householdId: meta.household_id,
            promptKey: 'speech.transcribe',
            promptVersion: 1,
            tier: 'premium',
          },
          deps: { fallback: deps.fallback, writeUsage: deps.writeUsage },
          signal: req.signal,
        });
      } catch (err) {
        if (err instanceof AIError) {
          throw new HttpError(
            err.code === 'TIMEOUT' || /TIMEOUT/.test(err.message) ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
            'Transcription is not available right now. Please type your message.',
          );
        }
        throw err;
      }
      const body = AiTranscribeResponse.parse({
        text: result.text.trim(),
        language: result.language ?? (meta.language_hint === 'auto' ? 'und' : meta.language_hint),
        duration_ms: meta.duration_ms,
      });
      return Response.json(body, { headers });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err, requestId);
      console.error(JSON.stringify({ level: 'error', request_id: requestId, error: String(err) }));
      return errorResponse(
        new HttpError('INTERNAL', 'Something went wrong. Please try again.'),
        requestId,
      );
    }
  };
}
