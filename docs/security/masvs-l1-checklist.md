# OWASP MASVS L1 checklist (S7-03)

> Status of the Thuluth Expo app and its backend against OWASP MASVS v2 controls in the **MAS-L1** profile (the
> v1 "L1" baseline). Findings and fixes are in [`s7-security-review.md`](s7-security-review.md) (IDs `S7-SEC-nn`).
> This review was internal. Every row marked **needs-human** needs a release build, a device or a store or dashboard
> setting, and is the scope handed to the external tester (review section 6).
>
> Status values: **pass** (implemented, evidence below), **partial** (implemented with a documented gap),
> **needs-human** (cannot be verified from source; must be checked on a release build, device or dashboard),
> **n/a** (not in the L1 profile or not applicable).
>
> Line numbers are as of Sprint 7. Paths are relative to the repository root.

## MASVS-STORAGE

| Control | Status | Evidence |
|---|---|---|
| STORAGE-1 The app securely stores sensitive data | pass | Session tokens in SecureStore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (`apps/mobile/src/lib/supabase/secure-session-storage.ts:9`). Health data cache and drafts in AES-256 MMKV (`apps/mobile/src/lib/storage/mmkv.ts:17-21`) with a per-install key in SecureStore (`apps/mobile/src/lib/storage/sensitive-key.ts:19-26`). Invite tokens in SecureStore, never MMKV (`apps/mobile/src/lib/auth/pending-invite.ts:12-15`). The unencrypted `thuluth.app` store holds preferences and flags only (`mmkv.ts:5-6`) |
| STORAGE-2 The app prevents leakage of sensitive data | partial | Sentry: `sendDefaultPii: false`, no screenshot or view hierarchy, `beforeSend` and `beforeBreadcrumb` scrubbing (`apps/mobile/src/lib/sentry/init.ts:38-44`, `scrub.ts:11`, tests `lib/sentry/__tests__/scrub.test.ts`). Analytics schemas are `.strict()` with no free text (`packages/shared/src/analytics/events.ts:8,38`). Sign-out purges caches, query client, analytics queue and Sentry user (`apps/mobile/src/lib/auth/sign-out.ts:30-40`). Android backups off (`apps/mobile/app.config.ts:89`, S7-SEC-09). No server secret in the app (AC-S3): CI job `supply-chain` runs `tooling/scripts/check-mobile-secrets.sh --bundle`, which refuses env reads of `SERVICE_ROLE` / `*SECRET*` / non-`EXPO_PUBLIC_` `*_KEY`, `*_TOKEN`, `*_PASSWORD` names in `apps/mobile` and `packages/shared/src` and `eas.json`, and scans the public app config and an offline `expo export` bundle for service-role JWT payloads, `sb_secret_`, `sk-ant-`, `sk-proj-`, `sk_`, `os_v2_app_`, `AIza` keys, PEM private keys, server secret names and the local Vault values (with a `--self-test` of planted fixtures). EXIF stripped by re-encoding (`features/meal-log/utils/image-rules.ts:3`). **Gap:** `FLAG_SECURE` and the iOS app-switcher privacy overlay (16 §15) wait on app lock, which is not built; no production `console.*` stripping plugin |

## MASVS-CRYPTO

| Control | Status | Evidence |
|---|---|---|
| CRYPTO-1 The app employs current strong cryptography | pass | No custom crypto on device. MMKV `AES-256` (`mmkv.ts:19-20`). Key from `expo-crypto` `getRandomBytesAsync(32)` (`sensitive-key.ts:22`). Server: SHA-256 token hashes, `crypto.getRandomValues` tokens (`supabase/functions/_shared/crypto.ts:1-12`) |
| CRYPTO-2 The app performs key management according to best practices | partial | MMKV key generated per install and held in Keychain or Keystore, device-only (`sensitive-key.ts:23`). Server secrets only in Supabase function secrets and Vault, with rotation pairs (`_shared/auth.ts:79-82,95-100`). **Gap:** server-side note encryption (0022b, `household_keys`, AC-S8) is deferred, so notes rely on RLS and disk encryption |

## MASVS-AUTH

| Control | Status | Evidence |
|---|---|---|
| AUTH-1 The app uses secure authentication and authorization protocols | pass | Supabase Auth with PKCE (`apps/mobile/src/lib/supabase/client.ts:50-53`), email OTP with `otp_expiry = 600` and `max_frequency = 60s` (`supabase/config.toml:81-82`), Apple and Google ID tokens. JWT verified on every user function (`_shared/auth.ts:20-34`, `_shared/clients.ts:14-31`). Authorization by RLS (`supabase/tests/database/rls/*`) and in-function membership checks (review section 4). Schema invariants: `rls/000_invariants.test.sql`, `rls/005_security_invariants.test.sql` |
| AUTH-2 The app performs local authentication securely | n/a | No local (biometric or PIN) authentication yet. App lock (16 §15) is planned and is optional. Re-check when it ships |
| AUTH-3 The app secures sensitive operations with additional authentication | pass | Step-up re-auth (`amr` age) on account export and deletion (`_shared/auth.ts:51-65`; `account-delete/handler.ts`, `account-export/handler.ts`). Ownership transfer and role changes are owner-only in SQL (`transfer_household_ownership`, `household_members_update_owner`) |

## MASVS-NETWORK

| Control | Status | Evidence |
|---|---|---|
| NETWORK-1 The app secures all network traffic according to best practices | pass / needs-human | All endpoints are HTTPS (Supabase, Sentry, RevenueCat, OneSignal). No `NSAllowsArbitraryLoads` in `apps/mobile/app.config.ts:63-80` (ATS on). Release Android builds have no cleartext (Expo enables it only in debug). External links are fixed https origins (`features/knowledge/components/knowledge-parts.tsx:158-160`). **needs-human:** confirm on the release IPA and AAB (`Info.plist`, merged `AndroidManifest.xml`) |
| NETWORK-2 The app performs identity pinning for all remote endpoints under the developer's control | n/a | Not in the L1 profile. Pinning was rejected for v1 (16 §15, Supabase certificate rotation risk) |

## MASVS-PLATFORM

| Control | Status | Evidence |
|---|---|---|
| PLATFORM-1 The app uses IPC mechanisms securely | pass | Deep links go through a fixed route map (`apps/mobile/src/navigation/linking.ts:31-100`). Invite links are intercepted and the token is checked against `^[A-Za-z0-9_-]{32,128}$` (`pending-invite.ts:12-35`) and re-validated server-side with Zod (`packages/shared/src/contracts/household-invite.ts:19`). Android intent filter is limited to `https://thuluth.app/invite` with `autoVerify` (`app.config.ts:91-98`). Universal links via `applinks:thuluth.app` (`app.config.ts:66`). The Debug screen is registered only in development or behind the `debug_menu` flag (`navigation/stacks/more-stack.tsx:31,131`). **Open:** custom-scheme invite form (S7-SEC-11, PO decision) |
| PLATFORM-2 The app uses WebViews securely | pass | No WebView. External content opens in the system browser through `Linking.openURL` |
| PLATFORM-3 The app uses the user interface securely | partial | No health data is copied to the clipboard automatically. Analytics and Sentry are scrubbed. **Gap:** screenshot and app-switcher protection (16 §15) not implemented (tied to app lock) |

## MASVS-CODE

| Control | Status | Evidence |
|---|---|---|
| CODE-1 The app requires an up-to-date platform version | pass | Android `minSdkVersion: 26` (`app.config.ts:116`). The iOS minimum comes from the Expo SDK |
| CODE-2 The app has a mechanism for enforcing app updates | pass | `app.min_supported_version` flag and `UPGRADE_REQUIRED` (06 §2.6); EAS Update channels (`app.config.ts:60-62`) |
| CODE-3 The app is not vulnerable to known vulnerabilities | pass / needs-human | Expo SDK pinned, `pnpm-lock.yaml` committed, gitleaks in CI (`.github/workflows/pr.yml`, job `secrets`). Dependency CVE gate (16 §15 "CVE scanning"): job `supply-chain` runs `tooling/scripts/audit-deps.sh` = `pnpm audit --audit-level high --prod`, retried on registry errors so only a completed audit with high or critical advisories fails. Accepted exceptions, `package.json` `pnpm.auditConfig.ignoreGhsas`: GHSA-86w9-cpqp-85rv (`node-forge` via `expo>@expo/cli`) and GHSA-vfj7-8cjw-p6xm (`braces` via `expo>@expo/cli>@expo/metro-file-map>micromatch`), both with no patched release on 2026-10-06 and both in the Expo CLI, which runs at build time and is not in the app bundle. **needs-human:** security owner to confirm the two exceptions and remove them once a patched `@expo/cli` ships; moderate advisories (3 on 2026-10-06, `uuid`, `sprintf-js`, `postcss-selector-parser`, all build or test tooling) are not gated |
| CODE-4 The app validates and sanitizes all untrusted inputs | pass | Zod at every function boundary (`supabase/functions/_shared/http.ts`, `jsonHandler`), now with a 256 KB body cap and request id sanitising (`_shared/http.ts:7-46`, S7-SEC-05, S7-SEC-08). Storage paths are checked against uuid segments (`20261006130200_storage_buckets.sql:16-36`). AI attachment paths are tied to the caller's session (S7-SEC-06). DB guard triggers for child safety rules. Tests: `supabase/tests/functions/security-s7.test.ts` |

## MASVS-RESILIENCE

| Control | Status | Evidence |
|---|---|---|
| RESILIENCE-1 to 4 | n/a | MAS-R profile, not L1. Root and jailbreak detection is informational only by design (16 §15). Hermes bytecode in release builds |

## MASVS-PRIVACY

| Control | Status | Evidence |
|---|---|---|
| PRIVACY-1 The app minimizes access to sensitive data and resources | pass | Camera is requested only on meal photo capture (`features/meal-log/screens/meal-photo-capture-screen.tsx:64`). `READ_EXTERNAL_STORAGE` is blocked (`app.config.ts:90`). No location permission (city chosen manually). Data minimisation for AI payloads (AC-S5, 12 §) |
| PRIVACY-2 The app prevents identification of the user | pass | Sentry user is the id only (`lib/sentry/init.ts:63-66`). No ad or attribution SDKs (16 §15). Analytics carry no names or free text (`packages/shared/src/analytics/events.ts:8`) and honour `users.analytics_opt_out` server-side (`track_events`) |
| PRIVACY-3 The app is transparent about data collection and usage | needs-human | In-app consent flows (`consents`, `consent_versions`, `has_active_consent`) and privacy settings (`apps/mobile/src/features/privacy`). **needs-human:** App Store privacy nutrition label and Play Data safety form (S7-07) must match 16 §4 and §18 |
| PRIVACY-4 The app offers user control over their data | pass | Consent withdrawal (`consents_withdraw_own` policy; AI memory withdrawal triggers), account export and deletion (`account-export`, `account-delete`, 30-day grace, `execute_account_erasure`), AI memory controls (`clear_ai_memories`, `users.ai_memory_enabled`), analytics opt-out |

## Backend controls supporting L1 (MASVS assumes a secure backend)

| Area | Status | Evidence |
|---|---|---|
| RLS on every client-reachable table | pass | `supabase/tests/database/rls/000_invariants.test.sql:6-24`; `005_security_invariants.test.sql` invariant 1 |
| Definer functions: pinned empty `search_path`, authorisation, no anon or service-only exposure | pass | `005_security_invariants.test.sql` invariants 3 to 6; S7-SEC-01 and S7-SEC-02 fixes in `supabase/migrations/20261006150500_security_review_hardening.sql:22-103` |
| Views and matviews | pass | invariants 7 and 8 |
| Storage buckets and policies | pass | invariants 11 to 14; S7-SEC-03 (`20261006150500_security_review_hardening.sql:105-139`) |
| Edge Function auth, rate limits, size limits | pass | review section 4; `supabase/tests/functions/security-s7.test.ts` |
| Secret scanning | pass | gitleaks full history and working tree clean (S7-SEC-12); `.gitleaks.toml`. Mobile bundle and config secret check in CI (`tooling/scripts/check-mobile-secrets.sh`, AC-S3) |
