# 07 · React Native Folder Structure

> **Status:** Approved for implementation (v1) · **Owner:** Mobile Platform · **Deliverable:** 6
>
> **Related docs:** `00-foundations.md` (canonical names), `04-system-architecture.md`, `08-component-architecture.md`, `09-state-management.md`, `10-supabase-structure.md`, `11-authentication.md`, `12-ai-agent-architecture.md`, `03-design-system.md`, `20-ci-cd-pipeline.md`, `21-testing-strategy.md`

## Table of contents

1. [Goals and principles](#1-goals-and-principles)
2. [Monorepo tree](#2-monorepo-tree)
3. [Workspace packages](#3-workspace-packages)
4. [apps/mobile tree](#4-appsmobile-tree)
5. [Feature module anatomy](#5-feature-module-anatomy)
6. [Feature list](#6-feature-list)
7. [File naming rules](#7-file-naming-rules)
8. [Import aliases and boundary rules](#8-import-aliases-and-boundary-rules)
9. [Key bootstrap files](#9-key-bootstrap-files)
10. [Workspace configuration files](#10-workspace-configuration-files)
11. [Acceptance criteria](#11-acceptance-criteria)
12. [Additions beyond 00-foundations](#12-additions-beyond-00-foundations)

---

## 1. Goals and principles

1. **Feature-first.** Code that changes together lives together. A feature folder owns its screens, components, hooks, API calls, client stores, schemas and utilities. Deleting a feature folder should break only navigation registration and explicit cross-feature imports.
2. **One contract, three runtimes.** Zod schemas and TypeScript types in `packages/shared` are imported by the mobile app (Hermes), Edge Functions (Deno) and the AI evaluation runner (Node). `packages/ai-core` follows the same rule.
3. **Shallow, predictable paths.** At most four levels below `src/` for any file. No `index.ts` barrels inside features except the single public `index.ts` at the feature root (see section 8).
4. **The client never talks to an AI provider.** `packages/ai-core` is never imported by `apps/mobile`; an ESLint boundary rule enforces it.
5. **Generated code is fenced.** Generated database types live in `packages/shared/src/db/database.types.ts` and are never edited by hand.

## 2. Monorepo tree

Tooling: **pnpm workspaces** + **Turborepo**. Node 22 LTS, pnpm 9. Repository name: `qanun-al-thuluth`.

```text
qanun-al-thuluth/
├── apps/
│   └── mobile/                      # Expo + React Native app (see section 4)
├── packages/
│   ├── shared/                      # Zod contracts, DB types, i18n keys, constants (Hermes + Deno + Node)
│   ├── ai-core/                     # Provider abstraction, prompts, guardrails, evals (Deno + Node)
│   └── config/                      # eslint, tsconfig, tailwind preset, prettier, jest presets
├── supabase/
│   ├── config.toml                  # Local stack config incl. auth (OTP length, expiry, rate limits)
│   ├── migrations/                  # Timestamped SQL, reference DDL in 05-database-schema.md
│   ├── seed/                        # Seed SQL split by domain (catalog, prices, islamic, flags)
│   │   ├── 001_allergens.sql
│   │   ├── 010_ingredients.sql
│   │   ├── 020_recipes.sql
│   │   ├── 030_price_profiles_lahore.sql
│   │   ├── 040_islamic_sources.sql
│   │   └── 090_feature_flags.sql
│   ├── functions/                   # Deno Edge Functions, one folder per function name in 00 §7
│   │   ├── _shared/                 # cors.ts, auth.ts, errors.ts, supabase-admin.ts, sentry.ts, entitlements.ts
│   │   ├── ai-chat/index.ts
│   │   ├── ai-intake-assess/index.ts
│   │   ├── ai-generate-plan/index.ts
│   │   ├── ai-adjust-plan/index.ts
│   │   ├── ai-analyze-meal/index.ts
│   │   ├── ai-transcribe/index.ts
│   │   ├── grocery-generate/index.ts
│   │   ├── growth-compute/index.ts
│   │   ├── ramadan-generate/index.ts
│   │   ├── export-pdf/index.ts
│   │   ├── household-invite/index.ts
│   │   ├── account-export/index.ts
│   │   ├── account-delete/index.ts
│   │   ├── revenuecat-webhook/index.ts
│   │   ├── notifications-dispatch/index.ts
│   │   ├── prices-refresh/index.ts
│   │   ├── analytics-rollup/index.ts
│   │   ├── import_map.json          # maps @shared/* and @ai-core/* to ../../packages/*/src
│   │   └── deno.json
│   ├── templates/                   # Auth email templates (otp.html in en and ur)
│   └── tests/
│       ├── database/                # pgTAP: rls/, functions/, triggers/ (see 21-testing-strategy.md)
│       └── functions/               # Deno tests per Edge Function
├── tooling/
│   └── scripts/                     # gen-db-types.sh, check-i18n-keys.ts, verify-env.ts
├── .github/workflows/               # see 20-ci-cd-pipeline.md
├── .maestro/ -> apps/mobile/.maestro   (symlink for CI discoverability)
├── docs/                            # this specification
├── package.json                     # root scripts only, no runtime deps
├── pnpm-workspace.yaml
├── turbo.json
├── .nvmrc                           # 22
├── .npmrc                           # node-linker=hoisted (required by Metro/Expo)
└── README.md
```

| Folder | Purpose |
|---|---|
| `apps/mobile` | The only shipped client in v1. Expo managed workflow, EAS builds, New Architecture on. |
| `packages/shared` | Pure TypeScript, zero runtime dependencies except `zod`. Safe in Hermes, Deno and Node. |
| `packages/ai-core` | Provider adapters, routing, prompt rendering, output validation, guardrails and the eval harness. Imported by Edge Functions and the eval runner only. |
| `packages/config` | Shared tool configuration so every workspace lints and type-checks the same way. |
| `supabase/` | Database migrations, seeds, Edge Functions and their tests. Structure detailed in `10-supabase-structure.md`. |
| `tooling/scripts` | Repo maintenance scripts run through `pnpm tsx`. |

## 3. Workspace packages

### 3.1 `packages/shared`

```text
packages/shared/
├── package.json                     # name: @thuluth/shared, "type": "module", exports map below
├── tsconfig.json                    # extends @thuluth/config/tsconfig/library.json
└── src/
    ├── index.ts                     # re-exports public surface (contracts, constants, enums, types)
    ├── contracts/                   # Edge Function request/response schemas (00 §4.2)
    │   ├── common.ts                # ErrorEnvelope, Uuid, IsoDate, MoneyMinor, Paginated<T>
    │   ├── ai-chat.ts               # AiChatRequest, AiChatStreamEvent (SSE union)
    │   ├── ai-intake-assess.ts
    │   ├── ai-generate-plan.ts
    │   ├── ai-adjust-plan.ts
    │   ├── ai-analyze-meal.ts
    │   ├── ai-transcribe.ts
    │   ├── grocery-generate.ts
    │   ├── growth-compute.ts
    │   ├── ramadan-generate.ts
    │   ├── export-pdf.ts
    │   ├── household-invite.ts
    │   ├── account-export.ts
    │   ├── account-delete.ts
    │   └── index.ts
    ├── domain/                      # Zod schemas for table rows used in forms (insert/update shapes)
    │   ├── family-member.ts
    │   ├── health-profile.ts        # conditions, allergies, medications, supplements, goals, sensory
    │   ├── intake.ts                # per-step intake schemas (see 08 §6)
    │   ├── hydration.ts
    │   ├── fasting.ts
    │   ├── meal-log.ts
    │   ├── growth.ts
    │   ├── budget.ts
    │   └── grocery.ts
    ├── db/
    │   ├── database.types.ts        # GENERATED by `supabase gen types typescript`; do not edit
    │   └── helpers.ts               # Tables<'x'>, TablesInsert<'x'>, Enums<'x'> helper aliases
    ├── enums.ts                     # const arrays mirroring 00 §5 (MEAL_TYPES, EXPOSURE_STAGES, ...)
    ├── constants/
    │   ├── tiers.ts                 # FREE_LIMITS, PREMIUM_LIMITS from 00 §8
    │   ├── thuluth.ts               # plate split, fluid timing windows, stop-point copy keys
    │   ├── safety.ts                # CHILD_AGE_YEARS=18, FASTING_MIN_AGE=7, red-flag codes
    │   ├── locales.ts               # SUPPORTED_LOCALES = ['en','ur'] as const, RTL_LOCALES
    │   └── products.ts              # 'premium', 'thuluth_premium_monthly', 'thuluth_premium_annual'
    ├── i18n/
    │   ├── keys.ts                  # GENERATED typed key union from locales/en/*.json
    │   └── namespaces.ts            # NAMESPACES = ['common','auth','intake','plan',...] as const
    └── utils/
        ├── age.ts                   # ageInMonths(dob, onDate), lifeStageFor(dob)
        ├── money.ts                 # formatMinor(amountMinor, currency, locale)
        └── units.ts                 # kg<->lb, cm<->in, ml<->fl oz
```

Rules:

- No imports from `react`, `react-native`, `node:*`, `Deno`, or any platform API. CI runs `deno check packages/shared/src/index.ts` and `tsc --noEmit` against both a Hermes and a Node lib target.
- File extensions in relative imports are **explicit `.ts`** inside `packages/shared` and `packages/ai-core` (`import { Uuid } from './common.ts'`), with `allowImportingTsExtensions: true` and `moduleResolution: "bundler"`. This is what lets Deno import the source directly through `import_map.json` while Metro and TypeScript resolve the same files.
- `exports` map:

```json
{
  "name": "@thuluth/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts/index.ts",
    "./db": "./src/db/helpers.ts",
    "./i18n": "./src/i18n/keys.ts",
    "./constants/*": "./src/constants/*.ts",
    "./domain/*": "./src/domain/*.ts"
  },
  "dependencies": { "zod": "^3.23.0" }
}
```

### 3.2 `packages/ai-core`

```text
packages/ai-core/
├── package.json                     # name: @thuluth/ai-core
├── src/
│   ├── index.ts
│   ├── types.ts                     # AiProvider, CompletionRequest, StreamChunk, ToolDef, Usage
│   ├── providers/
│   │   ├── anthropic.ts             # fetch-based, no SDK (portable to Deno)
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   └── fake.ts                  # deterministic scripted provider for tests and evals
│   ├── router.ts                    # resolveRoute(routeKey, routes: AiModelRoute[]) with fallback chain
│   ├── prompts/                     # renderPrompt(template, vars) + versioned local fallbacks
│   ├── guardrails/
│   │   ├── child-safety.ts          # rejects restriction language / kcal targets for <18
│   │   ├── allergen.ts
│   │   ├── halal.ts
│   │   ├── citations.ts             # only verified islamic_sources ids allowed
│   │   └── red-flags.ts
│   ├── tools/                       # tool schemas the agent may call (see 12-ai-agent-architecture.md)
│   └── runtime/
│       ├── env.ts                   # getEnv(name) works with Deno.env and process.env
│       └── sse.ts                   # SSE encode/decode with Web Streams only
└── evals/                           # golden datasets and runner (see 21-testing-strategy.md §9)
    ├── datasets/*.jsonl
    ├── rubrics/*.md
    └── run.ts
```

Runtime rule: only Web-standard APIs (`fetch`, `ReadableStream`, `TextEncoder`, `crypto.subtle`, `AbortController`). Environment access goes through `runtime/env.ts`:

```ts
// packages/ai-core/src/runtime/env.ts
declare const Deno: { env: { get(name: string): string | undefined } } | undefined;

export function getEnv(name: string): string | undefined {
  if (typeof Deno !== 'undefined') return Deno.env.get(name);
  // deno-lint-ignore no-process-globals
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}
```

### 3.3 `packages/config`

```text
packages/config/
├── package.json                     # name: @thuluth/config
├── eslint/
│   ├── base.js                      # flat config: typescript-eslint strict, import order, no-restricted-imports
│   ├── react-native.js              # + react, react-hooks, react-native-a11y, i18next/no-literal-string
│   └── boundaries.js                # eslint-plugin-boundaries element types (section 8)
├── tsconfig/
│   ├── base.json                    # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
│   ├── library.json                 # for shared and ai-core
│   └── expo.json                    # extends expo/tsconfig.base + base.json
├── tailwind/
│   └── preset.js                    # design tokens from 03-design-system.md (colors, spacing, fonts)
├── jest/
│   └── preset.js                    # jest-expo preset + moduleNameMapper for aliases
└── prettier/
    └── index.json
```

## 4. apps/mobile tree

```text
apps/mobile/
├── app.config.ts                    # dynamic Expo config (section 9.2)
├── eas.json                         # build profiles: development, preview, production
├── babel.config.js                  # babel-preset-expo with jsxImportSource nativewind, reanimated plugin last
├── metro.config.js                  # withNativeWind, monorepo watchFolders
├── tailwind.config.js               # presets: [require('@thuluth/config/tailwind/preset')]
├── global.css                       # @tailwind base; components; utilities
├── nativewind-env.d.ts
├── tsconfig.json                    # extends @thuluth/config/tsconfig/expo.json, paths below
├── jest.config.js
├── index.ts                         # registerRootComponent(App)
├── assets/
│   ├── fonts/                       # Inter, NotoNastaliqUrdu, Amiri (scripture)
│   ├── images/
│   ├── icons/                       # app icon, adaptive icon, splash
│   └── lottie/
├── locales/                         # i18next resources (source of truth for i18n keys)
│   ├── en/{common,auth,onboarding,intake,plan,meals,grocery,hydration,fasting,growth,chat,
│   │       picky,autism,ramadan,budget,settings,subscription,help,errors}.json
│   └── ur/ ...same namespaces
├── .maestro/                        # E2E flows (21-testing-strategy.md §10)
├── .storybook/                      # on-device Storybook (08 §12)
└── src/
    ├── app/                         # bootstrapping and global providers
    │   ├── App.tsx                  # provider tree (section 9.1)
    │   ├── bootstrap.ts             # pre-render init: Sentry, i18n, fonts, RevenueCat, OneSignal
    │   ├── providers/
    │   │   ├── query-provider.tsx   # PersistQueryClientProvider + onlineManager/focusManager wiring
    │   │   ├── theme-provider.tsx   # NativeWind colorScheme sync with usePreferencesStore
    │   │   ├── i18n-provider.tsx    # I18nextProvider + RTL direction handling
    │   │   ├── auth-provider.tsx    # session restore, onAuthStateChange listener (11 §8)
    │   │   ├── app-lock-provider.tsx# biometric lock overlay (11 §14)
    │   │   └── toast-provider.tsx
    │   ├── error-boundary.tsx       # root boundary (08 §9)
    │   └── splash-gate.tsx          # holds splash until fonts + session + i18n are ready
    ├── navigation/
    │   ├── root-navigator.tsx       # Auth stack vs Onboarding stack vs Main tabs, by session status
    │   ├── auth-stack.tsx
    │   ├── onboarding-stack.tsx
    │   ├── main-tabs.tsx            # Today, Plan, Chat, Family, More
    │   ├── stacks/                  # one native stack per tab
    │   │   ├── today-stack.tsx
    │   │   ├── plan-stack.tsx
    │   │   ├── chat-stack.tsx
    │   │   ├── family-stack.tsx
    │   │   └── more-stack.tsx
    │   ├── linking.ts               # deep link config (thuluth://, https://thuluth.app)
    │   ├── types.ts                 # RootStackParamList and every stack's ParamList
    │   ├── navigation-ref.ts        # createNavigationContainerRef for non-component navigation
    │   └── route-names.ts           # const route name map
    ├── features/                    # see sections 5 and 6
    ├── components/
    │   ├── ui/                      # primitives (08 §4): button.tsx, text.tsx, input.tsx, card.tsx,
    │   │                            # sheet.tsx, chip.tsx, avatar.tsx, progress-ring.tsx, skeleton.tsx,
    │   │                            # empty-state.tsx, error-state.tsx, toast.tsx, icon.tsx, screen.tsx
    │   ├── layout/                  # screen-container.tsx, section-header.tsx, keyboard-aware-view.tsx
    │   └── form/                    # form-text-field.tsx, form-select.tsx, form-date-field.tsx (RHF bindings)
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts            # createClient<Database> with secure storage adapter
    │   │   ├── secure-session-storage.ts  # chunked expo-secure-store adapter (11 §7)
    │   │   ├── edge.ts              # invokeEdge<TReq,TRes>(name, body, schema) with error envelope parsing
    │   │   └── sse.ts               # streamEdge(name, body) for ai-chat SSE
    │   ├── query/
    │   │   ├── query-client.ts      # QueryClient defaults, mutation defaults registry
    │   │   ├── query-keys.ts        # key factory (09 §3)
    │   │   ├── persister.ts         # MMKV-backed persister
    │   │   └── offline-mutations.ts # setMutationDefaults for resumable offline mutations
    │   ├── storage/
    │   │   ├── mmkv.ts              # MMKV instances: 'app', 'query-cache', 'drafts'
    │   │   └── zustand-storage.ts   # createJSONStorage adapter
    │   ├── sentry/
    │   │   ├── init.ts
    │   │   └── scrub.ts             # beforeSend PII scrubber (health fields, emails, names)
    │   ├── onesignal/
    │   │   ├── init.ts
    │   │   └── identity.ts          # login(userId) / logout()
    │   ├── revenuecat/
    │   │   ├── init.ts
    │   │   └── identity.ts          # logIn(userId) / logOut()
    │   ├── i18n/
    │   │   ├── i18n.ts              # i18next init, namespaces, fallbackLng 'en'
    │   │   ├── rtl.ts               # applyDirection(locale) with I18nManager + reload
    │   │   └── format.ts            # date, number, money, hijri formatting via Intl
    │   ├── analytics/
    │   │   └── track.ts             # batched insert into analytics_events
    │   ├── auth/
    │   │   ├── google.ts            # native Google sign-in
    │   │   ├── apple.ts             # Apple sign-in with nonce
    │   │   └── sign-out.ts          # device cleanup sequence (11 §11)
    │   └── env.ts                   # typed Constants.expoConfig.extra access, validated by zod
    ├── theme/
    │   ├── tokens.ts                # JS mirror of tailwind preset for non-className APIs (charts, SVG)
    │   ├── fonts.ts                 # font family map per locale
    │   └── use-theme-colors.ts
    ├── hooks/                       # cross-feature hooks only: use-app-state.ts, use-debounce.ts,
    │                                # use-is-rtl.ts, use-reduced-motion.ts, use-online.ts
    ├── stores/                      # cross-feature Zustand stores (09 §5): session, active-household,
    │                                # preferences, entitlement, feature-flags
    ├── types/                       # global .d.ts (env, svg modules)
    └── test/
        ├── render.tsx               # renderWithProviders()
        ├── factories/               # test data builders (family-member.ts, meal-plan.ts, ...)
        ├── msw/                     # request handlers for PostgREST and Edge Functions
        └── setup.ts
```

Purpose notes for the top-level `src/` folders:

| Folder | Owns | Must not contain |
|---|---|---|
| `app/` | Startup sequence, providers, root error boundary, splash gating. | Feature logic, screens. |
| `navigation/` | Navigators, param list types, linking config, navigation ref. | Data fetching. Screens are imported from feature public APIs. |
| `features/` | Everything specific to one product area. | Generic UI primitives. |
| `components/ui` | Design-system primitives, styled only through NativeWind tokens. | Data fetching, i18n keys for domain copy, stores. |
| `components/layout`, `components/form` | Shared layout shells and React Hook Form bindings for primitives. | Feature schemas. |
| `lib/` | Singletons and adapters for third-party SDKs. Each SDK is imported **only** here. | React components (except provider glue where unavoidable). |
| `theme/` | Token mirrors and font maps for places className cannot reach. | Hard-coded colors outside the token list. |
| `hooks/` | Truly cross-cutting hooks used by three or more features. | Feature-specific hooks. |
| `stores/` | Zustand stores used across features. Feature-only stores live in `features/<f>/store`. | Server data copies. |
| `test/` | Test helpers, factories, mock handlers. | Production code. |

## 5. Feature module anatomy

```text
src/features/<feature>/
├── index.ts            # PUBLIC API: screens for navigation + hooks/components other features may use
├── screens/            # one file per route; owns queries via feature hooks (08 §3)
├── components/         # feature containers and domain components
├── hooks/              # React Query hooks (useXxxQuery, useXxxMutation) and view-model hooks
├── api/                # pure async functions calling supabase-js / invokeEdge; no React
├── store/              # feature-local Zustand stores (optional)
├── schemas/            # feature-only Zod schemas; shared ones come from @shared/domain
├── utils/              # pure functions, fully unit-tested
└── __tests__/          # colocated tests mirroring the tree (optional; *.test.ts(x) next to file also allowed)
```

| Subfolder | Purpose | Example (feature `hydration`) |
|---|---|---|
| `screens/` | Route components. Read params, call feature hooks, compose containers, handle loading/error/empty. | `hydration-today-screen.tsx`, `hydration-history-screen.tsx` |
| `components/` | Containers (connected to hooks) and domain components (pure props). | `hydration-ring-card.tsx`, `quick-log-bar.tsx` |
| `hooks/` | Query and mutation hooks keyed by the factory in `lib/query/query-keys.ts`. | `use-hydration-logs.ts`, `use-log-hydration.ts` |
| `api/` | Typed data access. Returns parsed domain objects, throws `AppError`. | `hydration-api.ts` with `listLogs(memberId, date)`, `insertLog(input)` |
| `store/` | Ephemeral or device-local UI state for this feature only. | `use-hydration-quick-log-store.ts` |
| `schemas/` | Form schemas not shared with the server. | `custom-volume-schema.ts` |
| `utils/` | Pure helpers. | `pre-meal-window.ts`, `volume-presets.ts` |

## 6. Feature list

Every MVP capability in the shared planning assumptions maps to exactly one feature folder.

| Feature folder | Scope | Main tables / functions |
|---|---|---|
| `auth` | Email OTP, Google, Apple, age gate, re-auth | `auth.*`, `users`, `consents` |
| `onboarding` | Welcome, locale, tradition preference, consents, household creation | `users`, `households`, `consents` |
| `intake` | Multi-step intake wizard per family member, AI assessment trigger | health profile tables, `ai-intake-assess` |
| `household` | Household settings, members, invitations, switcher | `households`, `household_members`, `household_invitations`, `household-invite` |
| `family` | Family member profiles and health profile editing | `family_members` and health profile tables |
| `plan` | Plan generation, adjustment, weekly view, plan detail | `meal_plans`, `daily_meals`, `ai-generate-plan`, `ai-adjust-plan` |
| `today` | Today dashboard: meals, hydration, fasting summary | `daily_meals`, `daily_meal_servings`, `hydration_logs` |
| `meals` | Meal tracking, serving status, acceptance, manual and photo logging | `daily_meal_servings`, `meal_logs`, `ai-analyze-meal` |
| `recipes` | Recipe browse and detail | `recipes`, `recipe_ingredients`, `portions` |
| `grocery` | Lists, shopping mode, substitutions | `grocery_lists`, `shopping_items`, `grocery-generate` |
| `budget` | Budget profile and dashboard | `budget_profiles`, `budget_entries` |
| `hydration` | Targets, logs, pre-meal windows | `hydration_targets`, `hydration_logs` |
| `fasting` | Fasting logs and timers | `fasting_logs` |
| `ramadan` | Ramadan planner | `ramadan_plans`, `ramadan-generate` |
| `growth` | Child growth and adult weight | `growth_tracking`, `weight_tracking`, `growth-compute` |
| `picky` | Division of Responsibility guide, exposure log, coaching | `food_exposures`, `coaching_tips` |
| `autism` | Safe foods, sensory profile, exposure ladders, food chaining | `sensory_profiles`, `exposure_ladders`, `exposure_ladder_steps` |
| `chat` | AI chat with text, voice, photo | `chat_sessions`, `chat_messages`, `ai-chat`, `ai-transcribe` |
| `knowledge` | Source citation sheets, recommendation detail | `islamic_sources`, `recommendations`, `recommendation_evidence` |
| `journal` | Daily nutrition journal | `nutrition_journal` |
| `notifications` | Inbox and preferences | `notifications`, `notification_preferences` |
| `subscription` | Paywall, premium gate, restore | RevenueCat, `subscriptions` |
| `exports` | PDF export requests and downloads | `exports`, `export-pdf` |
| `settings` | Profile, units, theme, locale, app lock, data export, account deletion | `users`, `account-export`, `account-delete` |
| `help` | Help center, disclaimers, contact | static content + `feature_flags` |

## 7. File naming rules

| Kind | Rule | Example |
|---|---|---|
| Any file | `kebab-case` with `.ts` or `.tsx` (00 §4.3) | `meal-serving-row.tsx` |
| React component | File in kebab-case, export in `PascalCase`, **named export only** | `export function MealServingRow` in `meal-serving-row.tsx` |
| Screen | Suffix `-screen.tsx`, export suffix `Screen` | `plan-week-screen.tsx` → `PlanWeekScreen` |
| Hook | `use-` prefix file, `useXxx` export | `use-active-plan.ts` → `useActivePlan` |
| Query hook | `use-<resource>.ts` for reads, `use-<verb>-<resource>.ts` for mutations | `use-shopping-items.ts`, `use-toggle-shopping-item.ts` |
| Zustand store | `use-<name>-store.ts`, export `useXxxStore` | `use-intake-draft-store.ts` |
| API module | `<resource>-api.ts`, plain async functions | `grocery-api.ts` |
| Zod schema | `<name>-schema.ts` in features; plain domain name in `packages/shared/src/domain` | `custom-volume-schema.ts` |
| Types-only file | `<name>.types.ts` | `chat.types.ts` |
| Test | Same base name + `.test.ts(x)`; Maestro flows `NN-<flow>.yaml` | `budget-bar.test.tsx`, `03-generate-plan.yaml` |
| Story | Same base name + `.stories.tsx` next to the component | `button.stories.tsx` |
| Constants | `SCREAMING_SNAKE_CASE` exports in a kebab-case file | `export const MAX_CHAT_ATTACHMENTS = 3` |
| Default exports | Forbidden except `App.tsx`, config files, and `*.stories.tsx` (Storybook CSF needs `default`) | |

## 8. Import aliases and boundary rules

### 8.1 Aliases

| Alias | Resolves to | Used from |
|---|---|---|
| `@/features/*` | `apps/mobile/src/features/*` | mobile |
| `@/components/*` | `apps/mobile/src/components/*` | mobile |
| `@/lib/*` | `apps/mobile/src/lib/*` | mobile |
| `@/navigation/*` | `apps/mobile/src/navigation/*` | mobile |
| `@/stores/*` | `apps/mobile/src/stores/*` | mobile |
| `@/hooks/*` | `apps/mobile/src/hooks/*` | mobile |
| `@/theme/*` | `apps/mobile/src/theme/*` | mobile |
| `@/test/*` | `apps/mobile/src/test/*` | mobile tests only |
| `@shared` / `@shared/*` | `packages/shared/src` | mobile, Edge Functions, ai-core |
| `@ai-core` / `@ai-core/*` | `packages/ai-core/src` | Edge Functions and evals only |

```jsonc
// apps/mobile/tsconfig.json
{
  "extends": "@thuluth/config/tsconfig/expo.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared": ["../../packages/shared/src/index.ts"],
      "@shared/*": ["../../packages/shared/src/*"]
    }
  },
  "include": ["src", "index.ts", "app.config.ts", "nativewind-env.d.ts", ".storybook"]
}
```

Metro resolves the same aliases natively from `tsconfig.json` `paths` (`experiments.tsconfigPaths: true` in `app.config.ts`), so `babel-plugin-module-resolver` is not used. Jest maps them in `@thuluth/config/jest/preset.js`:

```js
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@shared$': '<rootDir>/../../packages/shared/src/index.ts',
  '^@shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
},
```

Edge Functions map them in `supabase/functions/import_map.json`:

```json
{
  "imports": {
    "@shared": "../../packages/shared/src/index.ts",
    "@shared/": "../../packages/shared/src/",
    "@ai-core": "../../packages/ai-core/src/index.ts",
    "@ai-core/": "../../packages/ai-core/src/",
    "zod": "npm:zod@3.23.8",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

### 8.2 Boundary rules (ESLint enforced)

1. A feature imports another feature **only through its `index.ts`**: `import { FamilyMemberSwitcher } from '@/features/household'` is allowed; `'@/features/household/components/family-member-switcher'` is an error (`no-restricted-imports` pattern `@/features/*/*`).
2. `components/ui` may import only `@/theme/*`, `@/hooks/*` and React Native libraries. Never `@/features/*`, `@/lib/supabase/*` or `@/stores/*`.
3. `lib/*` never imports from `features/*` or `navigation/*`.
4. Third-party SDK packages (`@supabase/supabase-js`, `react-native-purchases`, `react-native-onesignal`, `@sentry/react-native`, `react-native-mmkv`, `expo-secure-store`, `@react-native-google-signin/google-signin`, `expo-apple-authentication`) may be imported only from `src/lib/**` and `src/app/**`.
5. `@ai-core` imports are banned in `apps/mobile` (rule 4 of section 1).
6. Relative imports may not climb more than one level (`../x` allowed, `../../x` forbidden); use an alias.
7. Import order: builtins, external, `@shared`, `@/` aliases, relative, styles; enforced by `import/order` with blank lines between groups.

```js
// packages/config/eslint/react-native.js (excerpt)
export default [
  {
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/features/*/*'], message: 'Import features through their public index.ts.' },
          { group: ['@ai-core', '@ai-core/*'], message: 'AI providers are server-only (00 §3).' },
          { group: ['../../*'], message: 'Use an alias instead of deep relative paths.' },
        ],
      }],
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
];
```

## 9. Key bootstrap files

### 9.1 `src/app/App.tsx` (provider tree order)

Order matters. Outer providers must not depend on inner ones.

| # | Provider | Why at this position |
|---|---|---|
| 1 | `Sentry.wrap` (HOC on export) | Captures errors from every provider below. |
| 2 | `GestureHandlerRootView` | Must wrap anything that uses gestures (sheets, swipe rows). |
| 3 | `SafeAreaProvider` | Layout insets for all screens and sheets. |
| 4 | `RootErrorBoundary` | Catches render errors in providers below; renders a non-themed fallback with restart. |
| 5 | `I18nProvider` | Fallback UI and everything else needs translations and direction. |
| 6 | `ThemeProvider` | Reads `usePreferencesStore` (sync MMKV) and applies NativeWind color scheme. |
| 7 | `QueryProvider` | Persisted cache restore; must exist before auth so auth can clear it. |
| 8 | `AuthProvider` | Session restore, identity wiring for Sentry/OneSignal/RevenueCat. |
| 9 | `BottomSheetModalProvider` | Sheets render above navigation. |
| 10 | `ToastProvider` | Above navigation so toasts survive route changes. |
| 11 | `AppLockProvider` | Overlays the navigator when the biometric lock is engaged. |
| 12 | `SplashGate` | Keeps the native splash until fonts, i18n, session and cache are ready. |
| 13 | `NavigationContainer` + `RootNavigator` | Innermost; screens can use every provider. |

```tsx
// apps/mobile/src/app/App.tsx
import 'react-native-gesture-handler';
import '../../global.css';
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { NavigationContainer } from '@react-navigation/native';

import { bootstrap } from './bootstrap';
import { RootErrorBoundary } from './error-boundary';
import { I18nProvider } from './providers/i18n-provider';
import { ThemeProvider, useNavigationTheme } from './providers/theme-provider';
import { QueryProvider } from './providers/query-provider';
import { AuthProvider } from './providers/auth-provider';
import { ToastProvider } from './providers/toast-provider';
import { AppLockProvider } from './providers/app-lock-provider';
import { SplashGate } from './splash-gate';
import { RootNavigator } from '@/navigation/root-navigator';
import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigation-ref';
import { routingInstrumentation } from '@/lib/sentry/init';

bootstrap(); // synchronous parts only: Sentry.init, i18n init, SDK configure (no network awaits)

function Navigation() {
  const theme = useNavigationTheme();
  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={theme}
      onReady={() => routingInstrumentation.registerNavigationContainer(navigationRef)}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootErrorBoundary>
          <I18nProvider>
            <ThemeProvider>
              <QueryProvider>
                <AuthProvider>
                  <BottomSheetModalProvider>
                    <ToastProvider>
                      <AppLockProvider>
                        <SplashGate>
                          <Navigation />
                        </SplashGate>
                      </AppLockProvider>
                    </ToastProvider>
                  </BottomSheetModalProvider>
                </AuthProvider>
              </QueryProvider>
            </ThemeProvider>
          </I18nProvider>
        </RootErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
```

### 9.2 `src/app/bootstrap.ts`

```ts
// apps/mobile/src/app/bootstrap.ts
import * as SplashScreen from 'expo-splash-screen';
import { initSentry } from '@/lib/sentry/init';
import { initI18n } from '@/lib/i18n/i18n';
import { initRevenueCat } from '@/lib/revenuecat/init';
import { initOneSignal } from '@/lib/onesignal/init';
import { env } from '@/lib/env';

let done = false;

export function bootstrap(): void {
  if (done) return;
  done = true;
  void SplashScreen.preventAutoHideAsync();
  initSentry({ dsn: env.SENTRY_DSN, environment: env.APP_ENV });   // first, so later failures are captured
  initI18n();                                                        // reads persisted locale from MMKV synchronously
  initRevenueCat({ apiKey: env.REVENUECAT_API_KEY });              // anonymous until AuthProvider calls logIn
  initOneSignal({ appId: env.ONESIGNAL_APP_ID });                   // no permission prompt here (asked in onboarding)
}
```

### 9.3 `app.config.ts`

```ts
// apps/mobile/app.config.ts
import type { ExpoConfig, ConfigContext } from 'expo/config';

type AppEnv = 'development' | 'staging' | 'production';
const APP_ENV = (process.env.APP_ENV ?? 'development') as AppEnv;

const suffix: Record<AppEnv, string> = { development: '.dev', staging: '.staging', production: '' };
const nameSuffix: Record<AppEnv, string> = { development: ' (Dev)', staging: ' (Staging)', production: '' };

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Thuluth${nameSuffix[APP_ENV]}`,
  slug: 'thuluth',
  scheme: 'thuluth',
  version: '1.0.0',
  runtimeVersion: { policy: 'fingerprint' },
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icons/icon.png',
  splash: { image: './assets/icons/splash.png', resizeMode: 'contain', backgroundColor: '#F7F3EA' },
  experiments: { tsconfigPaths: true, typedRoutes: false },
  updates: { url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID}`, fallbackToCacheTimeout: 0 },
  ios: {
    bundleIdentifier: `app.thuluth.mobile${suffix[APP_ENV]}`,
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ['applinks:thuluth.app'],
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSCameraUsageDescription: 'Take a photo of a meal so Thuluth can estimate what is on the plate.',
      NSPhotoLibraryUsageDescription: 'Choose a meal photo to analyse.',
      NSMicrophoneUsageDescription: 'Record a voice question for the nutrition assistant.',
      NSFaceIDUsageDescription: 'Unlock Thuluth with Face ID.',
      CFBundleAllowMixedLocalizations: true,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
      ],
    },
  },
  android: {
    package: `app.thuluth.mobile${suffix[APP_ENV]}`,
    adaptiveIcon: { foregroundImage: './assets/icons/adaptive-icon.png', backgroundColor: '#F7F3EA' },
    permissions: ['CAMERA', 'RECORD_AUDIO', 'USE_BIOMETRIC'],
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'thuluth.app', pathPrefix: '/invite' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  locales: { en: './locales/en/native.json', ur: './locales/ur/native.json' },
  extra: {
    APP_ENV,
    SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    ONESIGNAL_APP_ID: process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID,
    REVENUECAT_API_KEY_IOS: process.env.EXPO_PUBLIC_RC_IOS_KEY,
    REVENUECAT_API_KEY_ANDROID: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
    GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
  plugins: [
    ['expo-build-properties', {
      ios: { deploymentTarget: '15.1', useFrameworks: 'static' },
      android: { minSdkVersion: 26, compileSdkVersion: 35, targetSdkVersion: 35 },
    }],
    'expo-localization',
    'expo-secure-store',
    ['expo-font', { fonts: [
      './assets/fonts/Inter-Variable.ttf',
      './assets/fonts/NotoNastaliqUrdu-Regular.ttf',
      './assets/fonts/Amiri-Regular.ttf',
    ] }],
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', {
      iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME, // reversed iOS client id
    }],
    ['expo-local-authentication', { faceIDPermission: 'Unlock Thuluth with Face ID.' }],
    ['expo-image-picker', {
      photosPermission: 'Choose a meal photo to analyse.',
      cameraPermission: 'Take a photo of a meal so Thuluth can estimate what is on the plate.',
    }],
    ['expo-audio', { microphonePermission: 'Record a voice question for the nutrition assistant.' }],
    ['onesignal-expo-plugin', { mode: APP_ENV === 'production' ? 'production' : 'development' }],
    ['@sentry/react-native/expo', {
      organization: process.env.SENTRY_ORG,
      project: 'thuluth-mobile',
      url: 'https://sentry.io/',
    }],
    'expo-updates',
  ],
});
```

Notes:

- Only `EXPO_PUBLIC_*` values reach the bundle. The Supabase anon key is public by design; the service role key never appears in the app (see `16-security-architecture.md`).
- `src/lib/env.ts` validates `Constants.expoConfig.extra` with a Zod schema at startup and throws a readable error in development if anything is missing.
- RevenueCat (`react-native-purchases`) and MMKV need no config plugin with current versions; they autolink in dev builds.

### 9.4 `src/lib/supabase/client.ts`

```ts
// apps/mobile/src/lib/supabase/client.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@shared/db/database.types';
import { secureSessionStorage } from './secure-session-storage';
import { env } from '@/lib/env';

export const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    storage: secureSessionStorage,
    storageKey: 'thuluth.auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: { headers: { 'x-client-info': `thuluth-mobile/${env.APP_VERSION}` } },
});
```

### 9.5 `src/lib/storage/mmkv.ts`

```ts
// apps/mobile/src/lib/storage/mmkv.ts
import { MMKV } from 'react-native-mmkv';

/** App preferences and Zustand persisted stores. Not encrypted: contains no secrets or health data. */
export const appStorage = new MMKV({ id: 'thuluth.app' });

/** React Query persisted cache and intake drafts. Contains health data, so encrypted.
 *  The key is created on first launch and kept in expo-secure-store (see 11 §7). */
export function createSensitiveStorage(encryptionKey: string) {
  return {
    queryCache: new MMKV({ id: 'thuluth.query-cache', encryptionKey }),
    drafts: new MMKV({ id: 'thuluth.drafts', encryptionKey }),
  };
}
```

### 9.6 `src/navigation/linking.ts`

```ts
// apps/mobile/src/navigation/linking.ts
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['thuluth://', 'https://thuluth.app'],
  config: {
    screens: {
      InviteAccept: 'invite/:token',
      Main: {
        screens: {
          TodayTab: { screens: { Today: 'today' } },
          PlanTab: { screens: { PlanDay: 'plan/:planId/day/:date' } },
          ChatTab: { screens: { ChatThread: 'chat/:sessionId' } },
        },
      },
    },
  },
};
```

Invitation handling (token parked until the user is signed in) is specified in `11-authentication.md` §12.

## 10. Workspace configuration files

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["APP_ENV"],
  "tasks": {
    "typecheck": { "dependsOn": ["^typecheck"], "outputs": [] },
    "lint": { "outputs": [] },
    "test": { "dependsOn": ["^typecheck"], "outputs": ["coverage/**"] },
    "gen:db-types": { "cache": false, "outputs": ["packages/shared/src/db/database.types.ts"] },
    "gen:i18n-keys": { "inputs": ["apps/mobile/locales/en/**"], "outputs": ["packages/shared/src/i18n/keys.ts"] },
    "evals": { "cache": false, "dependsOn": ["^typecheck"] }
  }
}
```

```json
// package.json (root, excerpt)
{
  "name": "qanun-al-thuluth",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "gen:db-types": "supabase gen types typescript --local > packages/shared/src/db/database.types.ts",
    "db:test": "supabase test db",
    "fn:test": "deno test --allow-env --allow-net=127.0.0.1 supabase/tests/functions",
    "mobile": "pnpm --filter @thuluth/mobile start"
  }
}
```

```js
// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
module.exports = withNativeWind(config, { input: './global.css' });
```

## 11. Acceptance criteria

1. `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass from a clean clone.
2. `deno check supabase/functions/*/index.ts` passes and resolves `@shared` and `@ai-core` from source through `import_map.json`.
3. ESLint fails a PR that imports `@ai-core` in `apps/mobile`, deep-imports another feature, or imports a third-party SDK outside `src/lib` or `src/app`.
4. Every feature listed in section 6 exists with an `index.ts` and at least `screens/` and `hooks/`.
5. `packages/shared/src/db/database.types.ts` is regenerated in CI and the build fails on drift (see `20-ci-cd-pipeline.md`).
6. `gen:i18n-keys` produces a key union; `t('x.y')` with an unknown key is a type error.
7. A development build boots to the splash gate in under 2 seconds on a Pixel 6a with an empty cache (measured as in `21-testing-strategy.md` §13).

## 12. Additions beyond 00-foundations

| Addition | Reason |
|---|---|
| `packages/config` workspace (`@thuluth/config`) | 00 §3 lists `apps/mobile`, `packages/shared`, `packages/ai-core`, `supabase/`. A config package keeps lint, tsconfig, tailwind preset and jest preset identical across workspaces. |
| `tooling/scripts` folder | Repo maintenance scripts (type generation, i18n key check). |
| Encrypted MMKV instances `thuluth.query-cache` and `thuluth.drafts` with key in SecureStore | Persisted React Query cache and intake drafts contain health data. |
