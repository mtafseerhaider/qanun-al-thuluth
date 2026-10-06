# S7-03 structured internal security review

> Sprint 7, story S7-03 (`24-sprint-plan.md`). Scope: database (RLS, functions, views, grants), Storage, Edge
> Functions, the Expo app and secret hygiene. This was a structured internal review: code and configuration
> reading plus tests run against a local throwaway database and in-process function handlers. No network attacks
> were run against any deployed environment. The MASVS L1 mapping is in [`masvs-l1-checklist.md`](masvs-l1-checklist.md).
> Reference documents: `16-security-architecture.md` (16), `11-authentication.md` (11), `06-api-specification.md` (06),
> `10-supabase-structure.md` (10).

## 1. Summary

| Severity | Found | Fixed in S7-03 | Open (owner) |
|---|---|---|---|
| High | 0 | 0 | 0 |
| Medium | 4 | 4 | 0 |
| Low | 8 | 6 | 2 (PO / backend) |
| Informational | 9 | 1 | 8 (documented residual risk) |

No finding gave cross-household read or write access to rows. The two medium data-exposure findings (S7-SEC-01 and
S7-SEC-06) let a signed-in user learn facts about a user or household they do not belong to, or read a co-member's
private chat photo through the AI. Both are fixed and covered by tests.

## 2. Method

1. **Database.** Applied every migration and seed to a plain PostgreSQL 16 cluster (`DB_TEST_MODE=plain
   tooling/scripts/db-test.sh`, `KEEP_DB=1`), then queried the catalog. The checks were: RLS on every relation; every
   policy with its roles, `USING` and `WITH CHECK`; column-level `UPDATE` grants for `authenticated`; every
   `SECURITY DEFINER` function with its `proconfig` and its `anon` / `authenticated` `EXECUTE`; view options
   (`security_invoker`, `security_barrier`); materialized view grants; schema `USAGE`. Each definer function callable
   by a client role was read for an authorisation check.
2. **Storage.** Read every bucket row and `storage.objects` policy (`20261006130200`, `20261006140000`), plus the
   client and function code that writes to them.
3. **Edge Functions.** Read every `index.ts` and handler for authentication (`requireUser`, `requireInternal`,
   `requireRevenueCat`), membership and role checks, rate limits and quotas, idempotency, body size limits, CORS,
   logging and secret handling. Cross-checked `verify_jwt` in `supabase/config.toml`.
4. **Mobile.** Read `app.config.ts`, `eas.json`, storage (SecureStore, MMKV), Sentry and analytics scrubbing,
   deep links, external links, debug surfaces and sign-out purge.
5. **Secrets.** Ran `gitleaks git -c .gitleaks.toml` over the full history (62 commits, no leaks) and `gitleaks dir`
   over the working tree (no leaks after S7-SEC-12).

## 3. Findings

IDs are referenced from the migration, tests and the checklist. "Fix area" names the files changed in this story.

### S7-SEC-01 · Medium · Entitlement and consent helpers answered for any user (fixed)

`has_premium(p_user_id)`, `household_has_premium(p_household_id)`, `household_is_read_only(p_household_id)` and
`has_active_consent(p_user, p_kind, p_household)` are `SECURITY DEFINER` and executable by `authenticated`, because
RLS policies and triggers call them. None checked who was asking. Any signed-in user could therefore call
`rpc('has_active_consent', { p_user: <uuid>, p_kind: 'health_data' })` and learn whether a stranger had given
health-data or child-data consent. That is a health signal under GDPR art. 9. The same call shape probed premium
status. `household_has_premium` was also executable by `anon`. Exploiting it needs the victim's uuid, and uuids do
leak (invites, shared links, support).

**Fix** (`supabase/migrations/20261006150500_security_review_hardening.sql`): each helper now answers only for the
caller, a co-member (`shares_household_with`) or a household the caller belongs to. When `auth.uid()` is null it
answers in full: service role, cron and triggers run without a user JWT. An unauthorised call returns `false`
instead of raising, so policy and trigger paths keep their behaviour. `household_has_premium` is revoked from `anon`.
**Tests:** `supabase/tests/database/rls/005_security_invariants.test.sql` (behaviour asserts 15 to 18, and invariant 5,
"anon executes no definer function beyond the membership helpers").

### S7-SEC-02 · Low · One definer function used `search_path = public` (fixed)

`accept_household_invitation` pinned `search_path = public`. Every other definer function pins `''`. Its body is
fully qualified, but in Supabase `authenticated` holds `CREATE` on `public`, so the pin is weaker than intended.
**Fix:** `alter function ... set search_path = ''` in the same migration. Invariant 4 now requires `''` for every definer
function in `public`, `private` and `analytics`.

### S7-SEC-03 · Low · Storage policy gaps (fixed)

- `avatars_update` had no `WITH CHECK`, so the `USING` expression also served as the new-row check. An editor could
  upsert or move an avatar to any key under the household prefix. The insert policy only allows
  `members/{family_member_id}` for a member of that household. The update now enforces the insert shape.
- `meal_photos_delete`: the self-logging branch did not require live membership. A linked member who had left
  the household could still delete photos under their member id. It now requires `is_household_member`.

**Fix:** same migration. **Tests:** invariants 11 to 14: size and MIME limits on all six buckets, `recipe-images` the
only public bucket, `UPDATE` only on `avatars` and the admin recipe-image writer, and every update policy has a
`WITH CHECK`. The existing `functions/100_storage_policies` and `140_analytics_storage_cron` tests still pass.

Reviewed and fine:
- Paths are household- or user-prefixed and parsed with `path_household_id` and `path_segment_uuid` (strict uuid
  regex).
- Every policy qualifies `objects.name`.
- `exports` is read-only for clients.
- `voice-notes` is owner-only.
- `chat-attachments` is limited to the session owner.
- Direct `DELETE` on `storage.objects` is blocked by Supabase unless `storage.allow_delete_query = 'true'`. Erasure
  goes through the Storage API: `execute_account_erasure` returns prefixes and `account-delete` removes them.

### S7-SEC-04 · Low · Client roles held TRUNCATE, REFERENCES, TRIGGER (fixed)

Supabase's default grants give `anon` and `authenticated` `TRUNCATE`, `REFERENCES` and `TRIGGER` on every table.
PostgREST never issues these statements, but `TRUNCATE` is not subject to RLS. They are revoked on `public` and
`analytics`, including default privileges for future tables. Invariant 10 keeps them out.

### S7-SEC-05 · Medium · JSON body size limit not enforced (fixed)

06 §2.8 requires JSON bodies over 256 KB to be refused with `PAYLOAD_TOO_LARGE`. `jsonHandler` called
`req.json()` with no limit, and every user and cron function uses it. Only `revenuecat-webhook` had a limit, and it
counted UTF-16 characters after buffering the whole body.

**Fix** (`supabase/functions/_shared/http.ts`): `readBodyText` checks the declared `content-length` and then counts
the streamed bytes, cancelling the read once it passes the limit (chunked uploads have no length).
`MAX_JSON_BODY_BYTES = 256 KB` and `jsonHandler` accept a per-function `maxBodyBytes`. `revenuecat-webhook` uses the
same reader. `ai-transcribe` (multipart) keeps its own 5 MB check.
**Tests:** `supabase/tests/functions/security-s7.test.ts` (declared length, chunked stream stops early, multi-byte text).

### S7-SEC-06 · Medium · ai-chat could read a co-member's private chat photo (fixed; AI lane file)

`ai-chat` accepted any image `storage_path` under `{household_id}/` and downloaded it with the service role. The
`chat-attachments` storage policy limits objects to the session owner. A member could still pass
`{household}/{another member's session}/x.jpg` and get the AI to describe a private photo. The guard bypassed
the storage policy, and `..` segments were not rejected.

**Fix** (`supabase/functions/ai-chat/handler.ts`, minimal edit): image attachments must sit under
`{household_id}/{session_id}/` of a session the handler then verifies as the caller's own. Paths with `..` are
refused (`VALIDATION_FAILED`). The mobile app does not upload chat photos yet, so no client changes.
**Tests:** `security-s7.test.ts` (no session, another session, `..` traversal). **AI lane:** please keep this check if
you refactor the attachment path.

### S7-SEC-07 · Low · household-invite had no burst limit (fixed)

06 §2.7 sets a 5/min burst for `household-invite`, and 16 §16.2 requires the accept path to be throttled. Only the daily
create/resend quota existed. Accept tokens are 256-bit, so guessing is not practical, but nothing throttled scripted
calls. **Fix:** `consume_rate_limit('household-invite:{user}:min', 5, 60)` before every action
(`household-invite/handler.ts`, `store.ts`). **Test:** `household-invite.test.ts` "every action, accept included, has a
per-user burst limit".

### S7-SEC-08 · Low · Client-controlled request ids echoed into headers and logs (fixed)

`x-request-id` from the client was echoed into response headers and structured logs and, for `/sync`, into a
`revenuecat_events` id. **Fix:** `requestIdOf()` accepts only `[A-Za-z0-9._:-]{1,64}` and otherwise mints a uuid. It is
used in `jsonHandler`, `ai-transcribe`, `export-pdf` and `revenuecat-webhook`. **Test:** `security-s7.test.ts`.

### S7-SEC-09 · Low · Android backups included app data (fixed; mobile lane file)

Expo defaults `android:allowBackup` to true. The encrypted MMKV files would be unreadable without the Keystore key,
but the plain `thuluth.app` store and other app files would be backed up. **Fix:** `allowBackup: false` in
`apps/mobile/app.config.ts`. It applies on the next native build.

### S7-SEC-10 · Low · Meal photo upload used `upsert: true` without an UPDATE policy (fixed; mobile lane file)

`meal-photos` has no update policy by design, since photos are immutable. With `upsert: true`, a replay after a
successful upload is refused by RLS and the outbox keeps retrying. The fix avoids adding an update policy. **Fix:**
`upsert: false`, with "already exists" (409) treated as done (`features/meal-log/api/meal-log-api.ts`,
`utils/image-rules.ts`). **Test:** `features/meal-log/__tests__/meal-photo-upload.test.ts`.

### S7-SEC-11 · Low · Invite tokens accepted over the custom scheme (fixed; PO decision 2026-10-06)

16 §15 says invite tokens are accepted only over universal links. `pending-invite.ts` also accepted
`thuluth://invite/<token>`, which FR-AUTH-08 listed as the legacy form. Another app can register the `thuluth`
scheme and intercept a token. The token is bound to the invited email on accept (T15), which limits the impact.
**Fix:** the PO chose to drop the custom-scheme form. `parseInviteUrl` accepts only
`https://thuluth.app/invite/<token>` (and the `www.` and `?token=` forms); a `thuluth://invite...` link is
swallowed without parking its token, so it never reaches the router either. `household-invite` already emails and
shares the https form (`inviteShareUrl`). **Test:** `apps/mobile/src/lib/auth/__tests__/pending-invite.test.ts`.
**Dependency:** invites now work only when universal links do, so `apple-app-site-association` and
`assetlinks.json` must be live on `thuluth.app` (19 §9.2 and §9.3, 22 L2) before an invite can open the app. Until then an
invite link opens the web fallback page.

### S7-SEC-12 · Informational · Secret scan (fixed)

Full-history gitleaks found no leaks. The working-tree scan flagged the new test's literal fixture secrets, which are
now built at runtime. `.gitleaks.toml` allowlists stay narrow (two entries, both with a reason). `.env*` is ignored
except `.env.example`, whose header says only `EXPO_PUBLIC_*` values reach the bundle.

### Open low findings for backend and ops

- **S7-SEC-13 · Low · `graphql_public` exposed.** `supabase/config.toml` exposes `graphql_public`, but the app does
  not use GraphQL. 16 §16.3 says to disable `pg_graphql` if unused. **Owner:** backend (S7-06) to remove it from the
  exposed schemas, or disable the extension, in `thuluth-prod`.
- **S7-SEC-14 · Low · Public `health` function hits the database on every call.** It returns no counts or error text
  (good) but has no cache, so an attacker can drive one RPC per request. **Owner:** backend to add a 10 to 15 second
  in-memory cache or a gateway rate limit.

### Informational and residual risks (accepted, documented)

- **Service role inside user functions.** 16 §16.2 says AI and other user functions use a user-scoped client. In
  practice every user function uses the service role and checks membership, role and premium in code
  (`platform.membership`, `requireInviter`, the session owner checks). The review found these checks present on
  every handler. Still, one missing check on a future endpoint means cross-tenant access. This is the top item for
  the pen test.
- **JWT revocation.** `getClaims` verifies tokens locally with asymmetric keys, so a token for a deleted or
  signed-out user stays valid until it expires (`jwt_expiry = 3600`). `account-delete` revokes sessions (backend
  lane), but already-issued access tokens live up to an hour.
- **CORS `*`.** All functions answer `access-control-allow-origin: *`. Auth is a bearer token, never a cookie, so a
  browser origin gains nothing without a token. 16 §16.1 plans an allowlist for the Phase 2 web companion.
- **Note encryption (0022b, AC-S8) is still deferred.** Intake notes (`medical_conditions.notes`,
  `allergies.reaction_notes`, `nutrition_journal.notes`) are plaintext under RLS. 16 §10 needs `household_keys` and
  the `health-notes` function. Backlog for Phase 1.1.
- **App lock, `FLAG_SECURE` and the iOS app-switcher privacy overlay (16 §15) are not built.** The spec ties
  `FLAG_SECURE` to app lock, and app lock does not exist yet. Recorded as partial in the checklist.
- **`console.*` stripping in production (16 §15).** No Babel plugin. Audited call sites are `__DEV__`-guarded or log
  no PII.
- **Bundle scan for service keys (AC-S3). Closed in the launch follow-up (2026-10-06).** CI job `supply-chain` runs
  `tooling/scripts/check-mobile-secrets.sh --bundle` (source env reads, public app config, offline `expo export`
  bundle) and the dependency CVE gate `tooling/scripts/audit-deps.sh` (`pnpm audit --audit-level high --prod`). See
  the checklist rows STORAGE-2 and CODE-3.
- **Logged error text.** Functions log `String(err)` for unexpected errors. Provider and Postgres messages do not carry
  request bodies, but a provider could echo input in an error. Sentry for functions is not wired, so these stay in
  Supabase logs (retention 7 days on the platform).
- **Bucket MIME mismatch (functional).** The `ai-chat` contract allows `image/png`, but `chat-attachments` does not.
  `audio/m4a` is not a registered MIME type (`audio/mp4` / `audio/x-m4a` are what devices send). Fix when chat photo
  upload ships.

## 4. Controls verified (no change needed)

| Area | Evidence |
|---|---|
| RLS on every `public` table and partition, policies on every non-partition table | `rls/000_invariants.test.sql` 1 and 2; new invariant 1 extends this to every app schema reachable by client roles |
| `private` and `analytics` are not reachable by client roles | invariant 2; `config.toml:11` exposes only `public` (and `graphql_public`, S7-SEC-13) |
| Every definer function pins `search_path` | `000_invariants` 3; invariant 3 extends this to every non-system schema |
| Service-role-only RPCs closed to clients | invariant 6 (17 functions, incl. erasure, export, rate limits, queues, refreshes) |
| Views run as invoker; admin views gate on `is_admin()` | invariant 7; materialized views limited to price aggregates (invariant 8) |
| Policies never target PUBLIC or anon | invariant 9 |
| Column-level update grants on sensitive tables | `users` (no `is_internal`, `processing_restricted`, deletion columns), `households`, `household_members` (`role` only), `consents` (`withdrawn_at` only), `notifications` (`read_at`), `growth_tracking` (raw measures; safety flags service-only), `safety_events` |
| Internal functions: `x-internal-secret`, constant time, refuse when unset, rotation | `_shared/auth.ts:68-92`; `security-s7.test.ts` (four cron functions refuse missing or wrong secret before touching the store) |
| RevenueCat webhook: bearer secret in constant time, refuses when unset, replay-safe event ids, sandbox ignored in production | `_shared/auth.ts:95-109`; `revenuecat-webhook/handler.ts`; `revenuecat-webhook.test.ts` |
| Membership before action on user functions | every user handler resolves `membership(household, user)` or the owner before reading data (`ai-chat/handler.ts:172`, `grocery-generate`, `growth-compute`, `export-pdf`, `ramadan-generate`, `ai-*`) |
| Rate limits and quotas on expensive endpoints | `consumeTierQuota` (`_shared/entitlements.ts:120`) in every AI, grocery, growth, export and Ramadan function; `ai_quota_check` and global cost ceilings in `ai-chat`; `revenuecat-webhook/sync` 6/h; `household-invite` 5/min (S7-SEC-07) |
| Idempotency on writes | `idempotency_keys` through `platform.idempotencyBegin/Complete/Fail` in plan, grocery, export, account and AI analyze functions; `client_message_id` in `ai-chat`; `revenuecat_events.event_id` |
| Step-up re-auth for account export and delete | `assertRecentAuth` in `account-delete` and `account-export` |
| No secrets or PII in logs | every `console.*` in `supabase/functions` reviewed: request id, scope, counts and error codes only; invite emails are masked in responses (`maskEmail`) |
| Invite tokens | 32 random bytes, only the SHA-256 is stored, single use, 7-day expiry, bound to the invited email (`household-invite/handler.ts`, `_shared/crypto.ts`) |

## 5. Tests added

| File | What it guards |
|---|---|
| `supabase/tests/database/rls/005_security_invariants.test.sql` | 14 schema-wide invariants (RLS reachability, schema usage, definer `search_path` pinned and empty, anon `EXECUTE`, service-only RPCs, view and matview exposure, policy roles, dangerous table grants, bucket limits, public buckets, storage update policies) and 4 behaviour checks for S7-SEC-01 |
| `supabase/tests/functions/security-s7.test.ts` | Body limit (declared and streamed), request id sanitising, `requireInternal` and `requireRevenueCat` edge cases and rotation, the four cron functions refusing callers without the secret, `ai-chat` attachment prefix and traversal |
| `supabase/tests/functions/household-invite.test.ts` (+1 test) | Burst limit on every action, accept included |
| `apps/mobile/src/features/meal-log/__tests__/meal-photo-upload.test.ts` | Upload replay classification |

## 6. External pen test: recommended focus

A short gray-box test (3 to 5 days) against `thuluth-staging` with two households and every role (owner,
caregiver, viewer, linked teen) would cover the residual risk best. Priorities:

1. **Cross-tenant access through Edge Functions.** Every user function uses the service role (section 3, residual
   risk). Swap `household_id`, `family_member_id`, `meal_plan_id`, `session_id`, `grocery_list_id`, `export id` and
   storage paths between households and between roles (viewer write, caregiver owner-only actions) on every
   function in `config.toml`.
2. **PostgREST and RPC surface with a real JWT.** Horizontal access on every table, column-level update bypass
   (`users`, `households`, `household_members`, `growth_tracking`, `safety_events`), `soft_delete` on each allow-listed
   table, `swap_daily_meal`, `transfer_household_ownership`, `keep_household_on_downgrade`, `track_events`, and
   filters that could leak through `count=exact` or embedded resources.
3. **Storage.** Signed-URL scope and lifetime for `exports`, cross-household path guessing, MIME and size bypass
   (content-type spoofing, polyglot images), and the public `recipe-images` bucket listing.
4. **Auth.** Email OTP brute force and enumeration, OTP resend throttling (`max_frequency = 60s`, `email_sent`),
   Apple and Google token audience, session revocation after deletion or "sign out of all devices", and refresh-token
   reuse.
5. **AI functions.** Prompt injection through stored data (meal log descriptions, member names, memories) aimed at
   tool misuse or cross-member disclosure, quota and cost-ceiling bypass with parallel requests, and SSE resource
   exhaustion.
6. **Webhooks and cron.** `revenuecat-webhook` replay and forged events, and internal functions reachable without the
   secret.
7. **Mobile binary** (MASVS L1 verification): decompile the release IPA and AAB for secrets; check the SecureStore and
   Keychain accessibility class, MMKV encryption at rest, backups, deep-link fuzzing (`thuluth://`,
   `https://thuluth.app/invite/...`), and logs and pasteboard during health screens.

## 7. Needs a human

- **External pen test** (scope above): PO to commission. The sprint plan allows "external or structured internal",
  and this document is the internal part.
- **Store security forms:** App Store privacy nutrition label and Play Data safety form (S7-07). Use the data
  inventory in 16 §4 and §18 (third-party SDKs: Supabase, Sentry, RevenueCat, OneSignal, Anthropic and Google AI via
  the server only). Declare health and fitness data, email, user id, purchase history, crash data and product
  interaction. No tracking, no data sold, encryption in transit, deletion request in-app. Play's "Health apps"
  declaration and Apple's health-data review notes need the PO.
- **Production dashboard settings** (S7-06):
  - Auth rate limits and CAPTCHA decision for OTP.
  - Remove `graphql_public` (S7-SEC-13).
  - Confirm `storage.allow_delete_query` stays unset.
  - Confirm asymmetric JWT signing keys, so `getClaims` verifies locally.
  - Rotate the secrets `INTERNAL_CRON_SECRET` and `REVENUECAT_WEBHOOK_SECRET`, at least 32 random characters each.
- **PO decisions:** ~~S7-SEC-11 (custom-scheme invites)~~ decided and fixed 2026-10-06; app lock and screenshot protection timing; 0022b note
  encryption timing (AC-S8).
- **Apply the new migration and native build:** `20261006150500` lands with the next `db push`. The
  `allowBackup: false` change needs a new EAS build (it is native config, so EAS Update does not carry it).
