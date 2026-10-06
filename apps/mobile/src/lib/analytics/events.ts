import { z } from 'zod';

/**
 * Event registry skeleton (docs/18 §9, §10). Props are strict: unknown props fail validation, and the
 * privacy rules in 18 §14 apply (enum values only, no free text, no health values, no child ids).
 * TODO: move to packages/shared/src/analytics/events.ts once the catalog migration (18 §10) lands.
 */
export const EventSchemas = {
  app_opened: z.object({ cold_start: z.boolean() }).strict(),
  screen_viewed: z
    .object({
      screen: z
        .string()
        .regex(/^[A-Za-z]+$/)
        .max(40),
    })
    .strict(),
  locale_changed: z.object({ from: z.enum(['en', 'ur']), to: z.enum(['en', 'ur']) }).strict(),
  debug_test_event: z.object({ source: z.enum(['debug_screen', 'test']) }).strict(),
} as const;

export type EventName = keyof typeof EventSchemas;
export type EventProps<E extends EventName> = z.infer<(typeof EventSchemas)[E]>;

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EventSchemas, name);
}
