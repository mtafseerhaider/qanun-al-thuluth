# Qānūn al-Thuluth

A family nutrition companion built on Qānūn al-Thuluth, the Prophetic rule of thirds: one third food, one third drink, one third space. It blends Islamic dietary guidance with modern, evidence-based nutrition for the whole family. Working app name: **Thuluth**.

Product specification and implementation roadmap live in [`docs/`](docs/); start with [`docs/00-foundations.md`](docs/00-foundations.md).

## Repository layout

| Path               | What it is                                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| `apps/mobile`      | Expo (React Native) app: React Navigation 7, NativeWind, i18next (`en`, `ur` RTL)       |
| `packages/shared`  | Zod contracts, canonical enums, generated database types, domain utilities              |
| `packages/ai-core` | Multi-provider AI layer (Anthropic, OpenAI, Gemini), routing, fallback, metering, evals |
| `packages/config`  | Shared tsconfig, ESLint, Prettier, Tailwind preset and design tokens                    |
| `supabase`         | Migrations, seeds, Edge Functions (Deno) and pgTAP tests                                |

## Getting started

Requires Node 22 and pnpm 10. Deno 2 and the Supabase CLI (with Docker) are needed for Edge Functions and database work.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test          # all workspaces
pnpm db:test                                       # migrations + pgTAP (Supabase CLI, or plain Postgres with DB_TEST_MODE=plain)
deno test --config supabase/functions/deno.json --allow-env supabase/tests/functions
pnpm --filter @thuluth/ai-core evals --suite smoke # eval smoke suite on the fake provider
pnpm mobile                                        # Expo dev server (copy apps/mobile/.env.example to .env first)
```

Locally, the debug screen (More tab, development builds) signs in as the seeded user `owner@thuluth.test` / `thuluth-local-dev` from `supabase/seed/local/`.
