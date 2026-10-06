import { z } from 'zod';

import { Uuid } from './common.ts';

/** `POST /functions/v1/ai-transcribe` (06-api-specification §4.6), multipart with a `meta` part. */
export const AiTranscribeMeta = z.object({
  household_id: Uuid,
  language_hint: z.enum(['en', 'ur', 'ar', 'auto']).default('auto'),
  duration_ms: z.number().int().max(120_000),
});
export type AiTranscribeMeta = z.infer<typeof AiTranscribeMeta>;

export const AiTranscribeResponse = z.object({
  text: z.string(),
  language: z.string(), // BCP-47 detected, e.g. 'ur'
  duration_ms: z.number().int(),
});
export type AiTranscribeResponse = z.infer<typeof AiTranscribeResponse>;

export const TRANSCRIBE_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSCRIBE_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
] as const;
