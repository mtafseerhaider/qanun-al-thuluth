import { z } from 'zod';

import { Citation, Escalation, Locale, Uuid } from './common.ts';

/** `POST /functions/v1/ai-chat` (06-api-specification §4.1). Streams `ChatSseEvent`s. */
export const ChatAttachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    // chat-attachments/{household_id}/...
    storage_path: z.string().regex(/^[0-9a-f-]{36}\/.+\.(jpg|jpeg|png|webp|heic)$/i),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  }),
  z.object({
    kind: z.literal('meal_log'),
    meal_log_id: Uuid, // share an analysed meal into the chat
  }),
]);
export type ChatAttachment = z.infer<typeof ChatAttachment>;

export const ChatScreen = z.enum([
  'today',
  'plan',
  'recipe',
  'grocery',
  'growth',
  'ramadan',
  'chat',
  'meal_log',
]);

export const AiChatRequest = z.object({
  session_id: Uuid.nullable(), // null starts a new session
  household_id: Uuid,
  client_message_id: Uuid,
  message: z.object({
    text: z.string().trim().min(1).max(4000),
    input_mode: z.enum(['text', 'voice']).default('text'), // voice = text came from ai-transcribe
    attachments: z.array(ChatAttachment).max(4).default([]),
  }),
  focus_family_member_id: Uuid.optional(),
  screen_context: z.object({ screen: ChatScreen, entity_id: Uuid.optional() }).optional(),
  locale: Locale.optional(),
});
export type AiChatRequest = z.infer<typeof AiChatRequest>;

/** Mirrors the tool catalog in 12-ai-agent-architecture.md §8 (authoritative). */
export const ChatToolName = z.enum([
  'get_household_snapshot',
  'calculate_energy_needs',
  'search_meals',
  'generate_meal_plan',
  'adjust_meal_plan',
  'build_grocery_list',
  'estimate_cost',
  'compute_hydration_target',
  'search_islamic_sources',
  'get_growth_status',
  'log_meal',
  'create_exposure_ladder',
  'plan_ramadan',
  'analyze_meal_photo',
  'escalate_to_clinician',
]);
export type ChatToolName = z.infer<typeof ChatToolName>;

export const ChatToolCard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recipe'), recipe_id: Uuid }),
  z.object({
    kind: z.literal('plan_adjustment_proposal'),
    meal_plan_id: Uuid,
    change_request: z.string(),
    scope_summary: z.string(),
  }),
  z.object({
    kind: z.literal('log_proposal'),
    table: z.enum(['hydration_logs', 'meal_logs', 'fasting_logs', 'food_exposures']),
    values: z.record(z.unknown()),
  }),
]);
export type ChatToolCard = z.infer<typeof ChatToolCard>;

export const ChatSseEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message.start'),
    data: z.object({
      session_id: Uuid,
      user_message_id: Uuid,
      assistant_message_id: Uuid,
      model_route: z.string(),
      quota: z.object({ limit: z.number().int(), remaining: z.number().int() }),
    }),
  }),
  z.object({ type: z.literal('message.delta'), data: z.object({ text: z.string() }) }),
  z.object({
    type: z.literal('tool.call'),
    data: z.object({
      tool_call_id: z.string(),
      name: ChatToolName,
      display: z.string(), // localized status line: "Checking Aisha's profile..."
    }),
  }),
  z.object({
    type: z.literal('tool.result'),
    data: z.object({
      tool_call_id: z.string(),
      name: ChatToolName,
      ok: z.boolean(),
      summary: z.string().optional(),
      card: ChatToolCard.optional(),
    }),
  }),
  // [1], [2] markers in text
  z.object({
    type: z.literal('citation'),
    data: Citation.extend({ marker: z.number().int().positive() }),
  }),
  z.object({
    type: z.literal('safety'),
    data: z.object({
      action: z.enum(['notice', 'escalate']),
      escalation: Escalation.optional(),
      notice_key: z.string().optional(), // e.g. 'safety.notice.not_medical_advice'
    }),
  }),
  z.object({
    type: z.literal('follow_up'),
    data: z.object({ suggestions: z.array(z.string().max(80)).max(3) }),
  }),
  z.object({
    type: z.literal('done'),
    data: z.object({
      assistant_message_id: Uuid,
      finish_reason: z.enum(['complete', 'escalated', 'length', 'cancelled']),
      replayed: z.boolean().default(false),
    }),
  }),
  z.object({
    type: z.literal('error'),
    data: z.object({
      code: z.enum(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'INTERNAL', 'FEATURE_DISABLED']),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);
export type ChatSseEvent = z.infer<typeof ChatSseEvent>;
