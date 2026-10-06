import { z } from 'zod';

import { IsoInstant, Uuid } from './common.ts';

/**
 * RPC `track_events(p_events jsonb) returns integer` (18 §10, 05 §22.10 24.2; S7-12, the Sprint 6
 * leftover). Client ingestion of analytics events; replaces the Sprint 0 direct insert into
 * `analytics_events` (README "Analytics client contract").
 *
 * The server trusts nothing but `auth.uid()`: it drops events that are not in
 * `analytics_event_catalog` (or disabled), drops prop keys outside the event's allow-list and
 * non-scalar values, truncates strings to 40 characters, clamps `occurred_at` to the last 7 days,
 * ignores a `household_id` the caller is not a member of, takes `locale` / `country_code` from
 * `users`, and `app_version` / `platform` from the `x-app-version` / `x-platform` request headers.
 * Duplicate `event_id`s are ignored, so a retried batch is safe. Opted-out or processing-restricted
 * users get 0 and nothing is stored.
 */
export const TRACK_EVENTS_MAX_BATCH = 50;
/** Accepted events per user per rolling hour (18 §10); the rest are dropped and not counted. */
export const TRACK_EVENTS_HOURLY_LIMIT = 600;

export const TrackEventInput = z.object({
  event_id: Uuid,
  event: z.string().regex(/^[a-z][a-z0-9_.]{2,63}$/),
  props: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  occurred_at: IsoInstant,
  session_id: Uuid.optional(),
  household_id: Uuid.nullable().optional(),
});
export type TrackEventInput = z.infer<typeof TrackEventInput>;

/** Arguments for `supabase.rpc('track_events', args)`. */
export const TrackEventsArgs = z.object({
  p_events: z.array(TrackEventInput).min(1).max(TRACK_EVENTS_MAX_BATCH),
});
export type TrackEventsArgs = z.infer<typeof TrackEventsArgs>;

/** Number of events accepted (inserted or already present). */
export const TrackEventsResult = z.number().int().min(0).max(TRACK_EVENTS_MAX_BATCH);

/** Request headers PostgREST forwards to the RPC (`request.headers`). */
export const TRACK_EVENTS_HEADERS = {
  appVersion: 'x-app-version',
  platform: 'x-platform',
} as const;
