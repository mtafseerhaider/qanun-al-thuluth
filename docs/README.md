# Thuluth Documentation

Specification and implementation roadmap for **Thuluth: Family Nutrition** (formally *Qānūn al-Thuluth Family Nutrition Companion*), an AI-powered family nutrition consultant built on the Prophetic rule of thirds, Halal and Tayyib eating, and modern evidence-based and pediatric nutrition.

Start with [`00-foundations.md`](00-foundations.md). It holds the canonical names, enums, table catalog, Edge Function list, tier entitlements and safety position that every other document follows. If two documents disagree, `00-foundations.md` wins.

## Reading order

| Role | Read first |
|---|---|
| Everyone | 00, 01, 22 |
| Product and design | 01, 02, 03, 15 |
| Mobile engineers | 07, 08, 09, 11, 02, 03 |
| Backend engineers | 04, 05, 10, 06, 16 |
| AI engineers | 12, 13, 14, 15, 25 |
| DevOps and QA | 19, 20, 21, 16 |
| Planning | 22, 23, 24 |

## Documents

| # | Document | Covers |
|---|---|---|
| 00 | [Foundations and Canonical Decisions](00-foundations.md) | Name, stack, conventions, enums, table catalog, Edge Functions, tiers, locales, safety |
| 01 | [Product Requirements](01-product-requirements.md) | Personas, journeys, functional and non-functional requirements, KPIs |
| 02 | [UX Specification](02-ux-specification.md) | Information architecture, navigation map, user flows, screen inventory and specs |
| 03 | [Design System](03-design-system.md) | Tokens, color, typography, Islamic-friendly visuals, dark mode, accessibility, RTL, component catalog |
| 04 | [System Architecture](04-system-architecture.md) | Components, request paths, sequences, offline, scale, ADRs |
| 05 | [Database Schema](05-database-schema.md) | Full PostgreSQL DDL, RLS, functions, triggers, seeds |
| 06 | [API Specification](06-api-specification.md) | PostgREST usage, Edge Function contracts, SSE events, OpenAPI |
| 07 | [React Native Folder Structure](07-react-native-folder-structure.md) | Monorepo and app source layout |
| 08 | [Component Architecture](08-component-architecture.md) | Layers, props contracts, forms, lists, theming |
| 09 | [State Management](09-state-management.md) | React Query keys and mutations, Zustand stores |
| 10 | [Supabase Structure](10-supabase-structure.md) | Projects, storage, cron, functions, local workflow |
| 11 | [Authentication](11-authentication.md) | Email OTP, Google, Apple, sessions, invitations, roles |
| 12 | [AI Agent Architecture](12-ai-agent-architecture.md) | Nutrition agent, engines, provider abstraction, tools, prompts, guardrails |
| 13 | [Islamic Knowledge Module](13-islamic-knowledge-module.md) | Sources, grading, verification, seed set |
| 14 | [Meal Planning and Grocery](14-meal-planning-and-grocery.md) | Meal data model, plan algorithm, grocery, pricing, Punjab seasonal produce |
| 15 | [Family Health Modules](15-family-health-modules.md) | Growth, autism, picky eater, Ramadan and fasting, hydration, journal |
| 16 | [Security Architecture](16-security-architecture.md) | Threat model, RLS, privacy law, encryption, audit |
| 17 | [Subscription Architecture](17-subscription-architecture.md) | RevenueCat, pricing, entitlements |
| 18 | [Exports and Analytics](18-exports-and-analytics.md) | PDF exports, event taxonomy, metrics |
| 19 | [Deployment Architecture](19-deployment-architecture.md) | Environments, EAS, releases, DR |
| 20 | [CI/CD Pipeline](20-ci-cd-pipeline.md) | GitHub Actions workflows and gates |
| 21 | [Testing Strategy](21-testing-strategy.md) | Unit to E2E, RLS tests, AI evals |
| 22 | [MVP Roadmap](22-mvp-roadmap.md) | Scope, milestones, launch checklist |
| 23 | [Phase 2 Roadmap](23-phase-2-roadmap.md) | Post-launch epics |
| 24 | [Sprint Plan](24-sprint-plan.md) | Sprint 0 to 7 stories and Phase 2 outline |
| 25 | [Future Multi-Agent Architecture](25-future-multi-agent-architecture.md) | Specialist agents and migration path |

## Reference material

A printable 4-week family program built on the same principles (Lahore, October 2026 prices, picky-eater and autism protocols) was produced earlier in this project. Its meals, prices and exposure plans seed the catalog described in `14-meal-planning-and-grocery.md` and `15-family-health-modules.md`.
