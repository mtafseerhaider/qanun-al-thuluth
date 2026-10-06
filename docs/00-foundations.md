# 00 · Foundations and Canonical Decisions

> **Status:** Approved baseline for v1 · **Owner:** Architecture · **Applies to:** every document in `docs/`
>
> This file is the single source of truth for names, identifiers, enums and cross-cutting decisions. When another document disagrees with this one, this one wins and the other document is a bug.

---

## 1. Product name

**Recommended name: Thuluth** (ثُلُث, "one third"). Store listing: **Thuluth: Family Nutrition**. Tagline: *Eat in thirds. Grow in barakah.*

| Candidate | Why it works | Risk |
|---|---|---|
| **Thuluth** (recommended) | Short, ownable, carries the core idea (the rule of thirds) and echoes the Thuluth calligraphy script, which gives the brand a natural visual language. Pronounceable worldwide ("thu-looth"). | Needs a trademark and App Store / Play name search before launch. |
| Sufra | "The dining spread", warm and familial, widely understood across Urdu, Arabic, Persian, Turkish. | Generic; existing UK charity and restaurant brands use it. |
| Barakah Plate | Instantly communicates "blessed, balanced plate" in English. | Less distinctive; harder to own as a trademark. |
| Qānūn | Authority and tradition. | Means "law" to most Arabic speakers, which reads as strict, the opposite of the gentle tone we want for children. |

The full formal name *Qānūn al-Thuluth Family Nutrition Companion* is used in the About screen, legal documents and the repository name.

Placeholder identifiers (replace once the name is cleared):

| Item | Value |
|---|---|
| iOS bundle id / Android package | `app.thuluth.mobile` |
| Expo slug / scheme | `thuluth` / `thuluth://` |
| Universal link domain | `thuluth.app` |
| RevenueCat entitlement | `premium` |
| Store products | `thuluth_premium_monthly`, `thuluth_premium_annual` (Phase 2: `thuluth_family_coach_monthly`) |
| Supabase projects | `thuluth-dev`, `thuluth-staging`, `thuluth-prod` |
| Sentry projects | `thuluth-mobile`, `thuluth-edge` |
| OneSignal apps | `Thuluth Dev`, `Thuluth Prod` |

## 2. The core rule the product teaches

Qānūn al-Thuluth: *"The son of Adam fills no vessel worse than his stomach. It is sufficient for the son of Adam to eat a few morsels to keep his back straight. If he must, then one third for his food, one third for his drink and one third for his breath."* (Tirmidhi 2380; Ibn Majah 3349; graded sahih by al-Albani.)

Practical rules the app encodes, in every plan and coaching message:

1. **Plate method:** half vegetables and fruit, a quarter protein, a quarter whole-grain carbohydrate.
2. **Fluid timing:** water 20 to 30 minutes before meals, small sips during, drink freely from 30 to 60 minutes after.
3. **Pace:** meals last about 20 minutes; fullness takes 15 to 20 minutes to register.
4. **Stop point:** adults stop at about 70 to 80 percent full. Self-check: *"Could I eat more if I had to?"*
5. **Children are never restricted.** For anyone under 18 the rule is taught as *rhythm and mindful eating*, never as portion restriction or calorie counting. Growth comes first; seconds are always allowed when a child is hungry. This is a hard product constraint enforced in the AI guardrails (see `12-ai-agent-architecture.md`) and in plan generation validation (see `14-meal-planning-and-grocery.md`).

## 3. Technology baseline

| Concern | Choice | Notes |
|---|---|---|
| App runtime | Expo (managed workflow, latest stable SDK at project start, pinned), React Native New Architecture enabled | Dev builds via EAS, no Expo Go in production paths |
| Language | TypeScript `strict: true`, `noUncheckedIndexedAccess: true` | |
| Navigation | React Navigation 7 (native stack + bottom tabs) | Explicitly not Expo Router, per product decision |
| Styling | NativeWind v4 with a shared `tailwind.config.js` token preset | Tokens defined in `03-design-system.md` |
| Server state | TanStack React Query v5 | Persisted cache via MMKV for offline reads |
| Client state | Zustand v5 with `persist` middleware on MMKV | See `09-state-management.md` |
| Forms | React Hook Form + Zod (schemas shared in `packages/shared`) | |
| Backend | Supabase: Postgres 15+, Auth, Storage, Edge Functions (Deno), Realtime, pg_cron, pgvector | |
| AI | Provider abstraction over Anthropic Claude, OpenAI, Google Gemini; **called only from Edge Functions, never from the client** | Model routing is data-driven (`ai_model_routes` table) |
| Payments | RevenueCat (App Store, Play) | Server truth via webhook into `subscriptions` |
| Push | OneSignal | `external_id` = `users.id` |
| Errors / performance | Sentry (`@sentry/react-native`, Deno SDK in Edge Functions) | PII scrubbing mandatory |
| Product analytics | First-party `analytics_events` table in Supabase plus Postgres materialized views | Keeps health-adjacent behaviour data in our own database; no third-party analytics SDK in v1 |
| PDF export | `export-pdf` Edge Function renders HTML templates and sends them to a private Gotenberg (headless Chromium) service on Cloud Run, because Edge Functions cannot run Chromium and Urdu Nastaliq needs a real browser engine | See `18-exports-and-analytics.md` |
| Monorepo | pnpm workspaces + Turborepo: `apps/mobile`, `packages/shared`, `packages/ai-core`, `packages/config` (eslint, tsconfig, tailwind preset), `supabase/` | |

Default AI model routing (stored in `ai_model_routes`, changeable without a release):

| Route key | Default provider / model | Fallback |
|---|---|---|
| `chat.default` | Anthropic `claude-sonnet-5-5` | OpenAI flagship, then Gemini Pro |
| `plan.generate` | Anthropic `claude-opus-5-5` | Anthropic `claude-sonnet-5-5` |
| `plan.adjust` | Anthropic `claude-sonnet-5-5` | OpenAI flagship |
| `vision.meal_analysis` | Anthropic `claude-sonnet-5-5` | Gemini Pro (vision) |
| `classify.safety` / `classify.intent` | Anthropic `claude-haiku-4-5-20251001` | Gemini Flash |
| `speech.transcribe` | OpenAI transcription model | Gemini audio |
| `embed.knowledge` | OpenAI `text-embedding-3-large` (3072-d, stored reduced to 1536-d) | none (re-embed on change) |

## 4. Conventions

### 4.1 Database
- `snake_case`, plural table names, `uuid` primary keys named `id` defaulting to `gen_random_uuid()`.
- Every table has `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()` maintained by trigger `set_updated_at()`.
- User-owned tables use soft delete `deleted_at timestamptz` and RLS filters `deleted_at is null`.
- **Every family-scoped row carries `household_id`**, even when derivable through a parent, so RLS is one indexed predicate: `is_household_member(household_id)`.
- Measurements stored metric: `weight_kg numeric(5,2)`, `height_cm numeric(5,1)`, volume `*_ml integer`, energy `kcal numeric(7,1)`, nutrients in grams or milligrams per the column suffix (`_g`, `_mg`, `_mcg`).
- Money: `amount_minor bigint` + `currency char(3)` (ISO 4217). Never floats.
- Dates of a plan are `date` in the household's time zone (`households.timezone`, IANA name). Instants are `timestamptz`.
- Enums are Postgres `enum` types listed in section 5. New values are additive only.
- Schema lives in `supabase/migrations/` as timestamped SQL; the reference DDL is `05-database-schema.md`.

### 4.2 API
- CRUD goes through PostgREST (`supabase-js`) guarded by RLS.
- Anything that calls an AI provider, a third party, or writes across many tables goes through an Edge Function.
- Edge Functions accept and return JSON validated by Zod schemas in `packages/shared/src/contracts/`; errors use the envelope `{ "error": { "code": "STRING_CODE", "message": "human text", "details": {} } }`.
- Streaming responses use Server-Sent Events.

### 4.3 Code
- File names `kebab-case.ts(x)`; React components `PascalCase`; hooks `useXxx`; Zustand stores `useXxxStore`.
- Feature-first folders (see `07-react-native-folder-structure.md`).
- All user-facing strings go through i18n keys (`i18next`); no literals in components.

## 5. Canonical enums

```sql
create type household_role       as enum ('owner','caregiver','viewer','coach');
create type sex_at_birth         as enum ('female','male','unspecified');   -- needed for growth charts and energy equations
create type blood_group          as enum ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown');
create type activity_level       as enum ('sedentary','light','moderate','active','very_active');
create type life_stage           as enum ('infant','toddler','child','teen','adult','older_adult'); -- derived from age, stored for query speed
create type goal_type            as enum ('weight_loss','weight_gain','maintain','child_growth','energy','digestive_health','pregnancy_support','breastfeeding_support','blood_sugar','heart_health');
create type special_module       as enum ('pregnancy','breastfeeding','autism','adhd','picky_eater');
create type meal_type            as enum ('suhoor','breakfast','lunch','snack','dinner','iftar');
create type meal_status          as enum ('planned','eaten','partly_eaten','skipped','swapped');
create type plan_status          as enum ('draft','generating','active','completed','archived','failed');
create type plan_kind            as enum ('standard','ramadan','growth','weight_management','custom');
create type severity             as enum ('mild','moderate','severe','anaphylactic');
create type evidence_grade_hadith as enum ('sahih','hasan','daif','mawdu','sahih_shia','muwaththaq','hasan_shia','daif_shia','ungraded');
create type evidence_grade_science as enum ('high','moderate','low','very_low','expert_opinion');   -- GRADE
create type source_tradition     as enum ('shared','sunni','shia');
create type source_kind          as enum ('quran','hadith','imam_narration','scholarly');
create type verification_status  as enum ('unverified','in_review','verified','rejected');
create type subscription_tier    as enum ('free','premium');
create type subscription_status  as enum ('active','in_grace','in_billing_retry','cancelled','expired','paused');
create type chat_role            as enum ('user','assistant','system','tool');
create type notification_channel as enum ('push','in_app','email');
create type texture              as enum ('smooth','soft','crunchy','chewy','crispy','mixed','lumpy','wet','dry');
create type exposure_stage       as enum ('tolerate_on_table','look','touch','smell','lick','taste','chew_spit','eat_small','eat_portion');
create type acceptance_score     as enum ('0_refused','1_tolerated','2_touched','3_tasted','4_ate_some','5_ate_well');
create type fast_kind            as enum ('ramadan','sunnah_monday_thursday','ayyam_al_bid','arafah','ashura','qada','nafl','intermittent');
create type price_source         as enum ('seed','user_report','admin','partner_feed');
```

## 6. Table catalog (authoritative list)

Every document refers to tables by these names. Full DDL, indexes and RLS are in `05-database-schema.md`.

**Identity and tenancy**
| Table | Purpose | Key columns |
|---|---|---|
| `users` | Profile row 1:1 with `auth.users` | `id` (= auth uid), `display_name`, `locale`, `country_code`, `timezone`, `tradition_preference source_tradition`, `units ('metric'\|'imperial')`, `onboarding_completed_at` |
| `households` | A family unit being planned for | `owner_user_id`, `name`, `country_code`, `region`, `city`, `timezone`, `currency`, `family_size` |
| `household_members` | Which app users can access a household, with role | `household_id`, `user_id`, `role household_role` |
| `household_invitations` | Pending invites by email | `household_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at` |
| `family_members` | A person being planned for (may have no app account) | `household_id`, `linked_user_id null`, `name`, `date_of_birth`, `sex_at_birth`, `height_cm`, `weight_kg`, `blood_group`, `activity_level`, `life_stage`, `work_schedule jsonb`, `sleep_schedule jsonb`, `special_modules special_module[]`, `avatar_path` |

**Health profile (per family member, all carry `household_id` + `family_member_id`)**
| Table | Key columns |
|---|---|
| `medical_conditions` | `condition_code` (SNOMED CT where known), `label`, `diagnosed_on`, `notes` |
| `allergies` | `allergen_id`, `kind ('allergy'\|'intolerance')`, `severity`, `reaction_notes` |
| `medications` | `name`, `dose`, `frequency`, `food_interaction_flags text[]` |
| `supplements` | `name`, `dose`, `frequency` |
| `food_preferences` | `ingredient_id null`, `recipe_id null`, `label`, `strength smallint (1-3)`, `is_safe_food boolean` |
| `food_dislikes` | `ingredient_id null`, `label`, `reason ('taste'\|'texture'\|'smell'\|'color'\|'religious'\|'other')` |
| `nutrition_goals` | `goal_type`, `target_value numeric`, `target_unit`, `target_date`, `is_primary` |
| `pregnancy_profiles` | `trimester`, `due_date`, `gestational_diabetes boolean` |
| `sensory_profiles` | `texture_likes texture[]`, `texture_avoids texture[]`, `color_sensitivities text[]`, `presentation_prefs jsonb` (separate foods, same plate, cut shapes), `temperature_prefs`, `brand_rigidity boolean` |

**AI**
| Table | Key columns |
|---|---|
| `ai_assessments` | `household_id`, `family_member_id null`, `kind ('intake'\|'periodic'\|'plan_rationale')`, `summary`, `energy_targets jsonb`, `macro_targets jsonb`, `risk_flags text[]`, `model_route`, `prompt_version` |
| `chat_sessions` | `household_id`, `user_id`, `title`, `context_snapshot jsonb`, `last_message_at` |
| `chat_messages` | `session_id`, `household_id`, `role chat_role`, `content text`, `attachments jsonb`, `tool_calls jsonb`, `tokens_in`, `tokens_out`, `model`, `safety_flags text[]` |
| `ai_memories` | Long-term facts the agent may recall: `household_id`, `family_member_id null`, `fact`, `source_message_id`, `embedding vector(1536)`, `confidence`, `expires_at` |
| `ai_usage` | Metering: `user_id`, `household_id`, `route_key`, `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd_micros`, `latency_ms` |
| `ai_model_routes` | `route_key`, `provider`, `model`, `params jsonb`, `priority`, `enabled` |
| `prompt_templates` | `key`, `version`, `body`, `variables jsonb`, `is_active` |

**Food catalog (global, read-only to users, admin-managed)**
| Table | Key columns |
|---|---|
| `ingredients` | `name`, `name_i18n jsonb`, `category`, `budget_category_id`, `default_unit`, per-100 g nutrients (`kcal`, `protein_g`, `carbs_g`, `fiber_g`, `sugar_g`, `fat_g`, `sat_fat_g`, `sodium_mg`, `iron_mg`, `calcium_mg`, `zinc_mg`, `vitamin_a_mcg`, `vitamin_c_mg`, `vitamin_d_mcg`, `b12_mcg`, `folate_mcg`, `potassium_mg`, `omega3_g`), `halal_status ('halal'\|'haram'\|'mashbooh'\|'depends_on_source')`, `is_sunnah_food`, `fdc_id` (USDA), `textures texture[]`, `color` |
| `allergens` | `code` (EU-14 + US Big-9 superset), `name_i18n` |
| `ingredient_allergens` | `ingredient_id`, `allergen_id` |
| `recipes` | `title`, `title_i18n`, `cuisine`, `region_tags text[]`, `meal_types meal_type[]`, `servings`, `prep_min`, `cook_min`, `steps jsonb`, `texture_profile texture[]`, `colors text[]`, `kid_friendly`, `autism_friendly`, `ramadan_suitable`, `cost_tier smallint (1-3)`, `per_serving_nutrition jsonb` (computed), `image_path`, `source ('curated'\|'ai_generated'\|'user')`, `review_status verification_status` |
| `recipe_ingredients` | `recipe_id`, `ingredient_id`, `quantity`, `unit`, `grams` (normalized), `optional boolean`, `prep_note` |
| `meals` | A composed meal (one or more recipes + sides) usable in plans: `title`, `meal_type`, `components jsonb` (recipe ids, sides), `plate_split jsonb` (veg/protein/carb fractions) |
| `portions` | Portion guidance per life stage: `meal_id` or `recipe_id`, `life_stage`, `grams`, `household_measure` ("1 small roti, ½ katori daal"), `kcal` |
| `meal_alternatives` | `meal_id`, `alternative_meal_id`, `reason ('allergy'\|'budget'\|'autism'\|'picky'\|'season'\|'preference')`, `notes` |
| `budget_categories` | `code` ('staples','protein_animal','protein_plant','dairy','produce_veg','produce_fruit','oils_fats','spices','beverages','snacks'), `name_i18n` |
| `regions` | `country_code`, `region_code`, `name`, `climate_zone`, `default_currency` |
| `seasonal_produce` | `region_id`, `ingredient_id`, `month smallint`, `availability ('peak'\|'available'\|'scarce')`, `price_index numeric` |
| `price_profiles` | A regional price book: `region_id`, `city null`, `currency`, `effective_from` |
| `price_observations` | `price_profile_id`, `ingredient_id`, `unit`, `amount_minor`, `observed_on`, `source price_source`, `reporter_user_id null` |

**Plans and tracking (household-scoped)**
| Table | Key columns |
|---|---|
| `meal_plans` | `household_id`, `kind plan_kind`, `status plan_status`, `start_date`, `end_date`, `week_count`, `generated_by_assessment_id`, `budget_profile_id`, `rationale`, `version`, `parent_plan_id` (for adjustments) |
| `daily_meals` | A planned meal slot: `meal_plan_id`, `household_id`, `plan_date`, `meal_type`, `meal_id`, `scheduled_time`, `notes` |
| `daily_meal_servings` | Per member portion and tracking: `daily_meal_id`, `household_id`, `family_member_id`, `portion_id`, `adaptation ('none'\|'autism'\|'picky'\|'allergy'\|'pregnancy')`, `adapted_meal_id null`, `status meal_status`, `acceptance acceptance_score null`, `logged_at` |
| `meal_logs` | Free-form meal tracking outside a plan: `family_member_id`, `eaten_at`, `meal_type`, `description`, `photo_path`, `estimated_nutrition jsonb`, `fullness_before smallint`, `fullness_after smallint`, `source ('manual'\|'photo_ai'\|'plan')` |
| `budget_profiles` | `household_id`, `monthly_amount_minor`, `currency`, `strictness ('flexible'\|'target'\|'hard_cap')`, `category_split jsonb` |
| `budget_entries` | Actual spend: `household_id`, `budget_profile_id`, `amount_minor`, `category_id`, `spent_on`, `grocery_list_id null` |
| `grocery_lists` | `household_id`, `meal_plan_id null`, `period ('weekly'\|'monthly'\|'adhoc')`, `starts_on`, `ends_on`, `estimated_total_minor`, `currency`, `status ('open'\|'shopping'\|'done')` |
| `shopping_items` | `grocery_list_id`, `household_id`, `ingredient_id null`, `label`, `quantity`, `unit`, `estimated_minor`, `actual_minor`, `is_checked`, `substitution_for_item_id null`, `aisle`, `is_fresh` (buy weekly vs monthly) |
| `hydration_targets` | `family_member_id`, `daily_ml`, `schedule jsonb` (pre-meal windows), `basis jsonb` (age, weight, climate, pregnancy, fasting) |
| `hydration_logs` | `family_member_id`, `logged_at`, `volume_ml`, `beverage ('water'\|'milk'\|'laban'\|'juice'\|'tea'\|'other')`, `timing ('pre_meal'\|'with_meal'\|'post_meal'\|'other')` |
| `fasting_logs` | `family_member_id`, `fast_date`, `kind fast_kind`, `started_at`, `ended_at`, `completed boolean`, `exemption_reason null`, `notes` |
| `ramadan_plans` | `household_id`, `hijri_year`, `start_date`, `end_date`, `meal_plan_id`, `suhoor_time_strategy`, `child_participation jsonb`, `pregnancy_adjustments jsonb`, `city_prayer_times_source` |
| `growth_tracking` | Child measurements and computed percentiles: `family_member_id`, `measured_on`, `height_cm`, `weight_kg`, `bmi`, `head_circumference_cm null`, `height_for_age_z`, `weight_for_age_z`, `bmi_for_age_z`, `*_percentile`, `reference ('who_2006'\|'who_2007'\|'cdc_2000')` |
| `growth_reference_lms` | Reference tables: `reference`, `indicator`, `sex`, `age_months`, `l`, `m`, `s` |
| `weight_tracking` | Adult weight log: `family_member_id`, `measured_on`, `weight_kg`, `waist_cm null`, `bmi` |
| `nutrition_journal` | Daily reflection: `family_member_id`, `journal_date`, `mood`, `energy`, `digestion`, `thuluth_adherence smallint (0-3)`, `notes` |
| `food_exposures` | Exposure log for picky/autism: `family_member_id`, `ingredient_id`, `exposed_on`, `stage exposure_stage`, `acceptance acceptance_score`, `context`, `notes` |
| `exposure_ladders` | `family_member_id`, `target_ingredient_id`, `strategy ('exposure_ladder'\|'food_chaining')`, `status`, `current_step` |
| `exposure_ladder_steps` | `ladder_id`, `step_no`, `stage exposure_stage`, `food_label`, `bridge_from_ingredient_id null`, `criteria`, `completed_on` |
| `coaching_tips` | Parent coaching content: `module ('picky'\|'autism'\|'ramadan'\|'general')`, `age_min_months`, `age_max_months`, `body_i18n`, `evidence_id` |

**Islamic knowledge (global, curated)**
| Table | Key columns |
|---|---|
| `quran_references` | `surah`, `ayah_start`, `ayah_end`, `arabic_text`, `translation_i18n jsonb`, `translator`, `topic_tags text[]` |
| `hadith_references` | `collection` ('bukhari','muslim','tirmidhi','abu_dawud','ibn_majah','nasai','ahmad', ...), `book`, `number`, `arabic_text`, `translation_i18n`, `narrator`, `grade evidence_grade_hadith`, `graded_by`, `tradition source_tradition` |
| `imam_narrations` | `imam` (one of the Twelve Imams), `collection` ('al_kafi','tibb_al_aimma','bihar_al_anwar','wasail_al_shia','al_mahasin', ...), `volume`, `page`, `number`, `arabic_text`, `translation_i18n`, `grade evidence_grade_hadith`, `graded_by` |
| `islamic_sources` | Polymorphic index over the three tables above: `kind source_kind`, `ref_id`, `tradition`, `citation_text`, `embedding vector(1536)` |
| `source_verifications` | `islamic_source_id`, `status verification_status`, `reviewer_name`, `reviewer_credentials`, `reviewed_on`, `method`, `notes` |
| `foods_in_narrations` | `islamic_source_id`, `ingredient_id null`, `food_label`, `context ('recommended'\|'mentioned'\|'cautioned')` |
| `scientific_evidence` | `title`, `citation`, `doi`, `pmid`, `study_type`, `grade evidence_grade_science`, `summary`, `population` |
| `recommendations` | A reusable guidance unit: `code`, `title_i18n`, `practical_text_i18n`, `applies_to jsonb` (life stages, modules, goals), `contraindications jsonb` |
| `recommendation_evidence` | **Every recommendation stores Islamic source + scientific evidence + practical recommendation:** `recommendation_id`, `islamic_source_id null`, `scientific_evidence_id null`, `relationship ('supports'\|'context'\|'caution')` |
| `plan_recommendations` | Links a recommendation shown in a plan / chat to its instance: `household_id`, `meal_plan_id null`, `chat_message_id null`, `recommendation_id`, `family_member_id null` |

**Platform**
| Table | Key columns |
|---|---|
| `subscriptions` | `user_id`, `tier`, `status`, `product_id`, `store ('app_store'\|'play_store'\|'promotional')`, `rc_app_user_id`, `current_period_end`, `will_renew`, `raw_event jsonb` |
| `notifications` | `user_id`, `household_id null`, `channel`, `kind`, `title`, `body`, `data jsonb`, `scheduled_for`, `sent_at`, `read_at`, `onesignal_id` |
| `notification_preferences` | `user_id`, `kind`, `enabled`, `quiet_hours jsonb` |
| `devices` | `user_id`, `platform`, `onesignal_subscription_id`, `app_version`, `last_seen_at` |
| `consents` | `user_id`, `kind ('terms'\|'privacy'\|'health_data'\|'child_data'\|'ai_processing'\|'marketing')`, `version`, `granted_at`, `withdrawn_at` |
| `audit_log` | Append-only: `actor_user_id`, `household_id`, `action`, `entity`, `entity_id`, `diff jsonb`, `ip_hash`, `at` |
| `analytics_events` | `user_id`, `household_id`, `event`, `props jsonb`, `occurred_at`, `app_version`, `platform` (partitioned monthly) |
| `exports` | `household_id`, `user_id`, `kind ('meal_plan'\|'grocery_list'\|'nutrition_report'\|'growth_report'\|'ramadan_pack'\|'family_summary')`, `status`, `storage_path`, `expires_at` |
| `feature_flags` | `key`, `enabled`, `rules jsonb` |

## 7. Edge Functions (authoritative list)

| Function | Method | Purpose |
|---|---|---|
| `ai-chat` | POST (SSE) | Conversational agent turn; tool use; streaming |
| `ai-intake-assess` | POST | Turn completed intake into an `ai_assessments` row with energy, macro and hydration targets |
| `ai-generate-plan` | POST | Start an async plan generation job; returns `meal_plan_id` with status `generating` |
| `ai-adjust-plan` | POST | Produce a new plan version from a natural-language change request |
| `ai-analyze-meal` | POST | Photo (and optional text) to estimated foods, portions, nutrition and Thuluth feedback |
| `ai-transcribe` | POST | Voice note to text for chat |
| `grocery-generate` | POST | Build a grocery list from a plan with budget optimization and substitutions |
| `growth-compute` | POST | Compute z-scores, percentiles and alerts for a measurement |
| `ramadan-generate` | POST | Build a Ramadan plan and schedule from city prayer times |
| `export-pdf` | POST | Render a PDF export and return a signed URL |
| `household-invite` | POST | Create and email an invitation; accept with token |
| `account-export` | POST | GDPR data export (JSON + PDFs zip) |
| `account-delete` | POST | Right-to-erasure workflow |
| `revenuecat-webhook` | POST | Subscription lifecycle events (verified by shared secret) |
| `notifications-dispatch` | cron | Due reminders to OneSignal |
| `prices-refresh` | cron | Recompute price profiles from observations |
| `analytics-rollup` | cron | Refresh analytics materialized views |
| `promo-redeem` | POST | Redeem promotional codes for coaches and madrasas (see `17-subscription-architecture.md`) |
| `health-notes` | POST | Encrypt and decrypt free-text health notes with Vault-held keys (see `16-security-architecture.md`) |

## 8. Tier entitlements

| Capability | Free | Premium |
|---|---|---|
| Households | 1 | Unlimited |
| Family members per household | 6 | 20 |
| Meal plans | 1 active weekly plan, curated templates, light AI personalization | Unlimited, multi-week, full AI planning and adjustments |
| AI chat | 20 messages per day, text only | 200 messages per day (fair-use), voice, photo meal analysis, long-term memory |
| Grocery lists | Basic list from plan | Budget optimization, substitutions, monthly purchasing, price tracking |
| Hydration, fasting and meal tracking | Yes | Yes |
| Growth tracking | Log measurements, latest value and percentile, **safety alerts (faltering growth, rapid loss) on every tier** | Percentile charts, trends, non-safety alerts, reports |
| Autism module | Safe-food list | Sensory profile, exposure ladders, food chaining, alternatives |
| Picky eater module | Division of Responsibility guide, exposure log | Coaching plans, acceptance analytics, new-food progression |
| Ramadan planner | Generic Suhoor/Iftar tips | Full family Ramadan plan and schedules |
| PDF exports | None | All export types |
| Analytics and family coaching | None | Yes |

Entitlements are enforced on the server (Edge Functions check `has_premium(user_id)`; RLS-guarded insert triggers check household and member counts). The client only hides or teases features.

## 9. Supported locales and regions

- **MVP locales:** English (`en`), Urdu (`ur`, RTL, Noto Nastaliq Urdu). Arabic scripture text is always rendered in Arabic (Amiri / KFGQPC font) regardless of locale.
- **Phase 2 locales:** Arabic (`ar`, RTL), French, Turkish, Malay, Indonesian, Bengali.
- **Launch price books:** Pakistan (Lahore, Karachi, Islamabad), with Punjab seasonal produce. Phase 2: UAE, Saudi Arabia, UK, US, Canada.
- Currency follows `households.currency`; units follow `users.units`.

## 10. Safety position (non-negotiable)

1. The app is a **wellness and education product, not a medical device**. It does not diagnose or treat. All plans carry a clinician disclaimer.
2. **Red-flag escalation:** eating disorder signals, rapid child weight loss, faltering growth (crossing two major percentile lines or weight-for-age below the 3rd percentile), signs of dehydration, pregnancy complications, severe allergy reactions, diabetes on insulin or sulfonylureas with fasting. The agent stops planning, explains why, and recommends a clinician.
3. **Children:** no calorie targets shown to children, no weight-loss goals for anyone under 18, no fasting plans for children under 7, gentle practice-fast guidance only for children 7 to puberty.
4. **Pregnancy and breastfeeding:** no caloric deficit; Ramadan fasting decisions deferred to the user's clinician and scholar, with the app supporting whichever choice is made.
5. **Islamic content:** only verified sources (`verification_status = 'verified'`) are cited to users. The agent never issues fatwas; it cites, and directs fiqh questions to a qualified scholar. Sunni and Shia sources are both supported and labelled by tradition; users choose what they see.
6. **Never claim a narration cures a disease.** Islamic sources are presented as guidance and tradition; health claims rest on the scientific evidence column.

## 11. Cross-document resolutions

The 25 documents were written in parallel against this baseline. Where they made different calls, these resolutions are binding.

| Topic | Resolution |
|---|---|
| Supabase region | **Frankfurt (`eu-central-1`)** for all environments. Gives GDPR and UK GDPR alignment, and Pakistan traffic does not reliably reach Mumbai faster. Revisit only for a GCC residency requirement. |
| Life stage bands | As `derive_life_stage()` in `05-database-schema.md`: infant under 12 months, toddler 12 to 35 months, child 3 to 12 years, teen 13 to 17, adult 18 to 64, older adult 65 and over. |
| Sensitive note encryption | pgsodium is deprecated on Supabase. Free-text health notes are encrypted in the `health-notes` Edge Function with keys in Supabase Vault, stored in `*_enc` columns. |
| Rate limiting | One mechanism: `rate_limit_buckets` table with `consume_rate_limit()` as defined in `06-api-specification.md`. Any mention of a `rate_limits` table means this. |
| Premium scope | Household features (plans, modules, exports) follow the household owner's entitlement via `household_has_premium(household_id)`. AI chat quotas are per user via `has_premium(user_id)`. |
| Photo meal analysis on Free | Premium only, as in section 8. A free trial of a few analyses is a Phase 2 experiment behind a feature flag. |
| Coach role | Enum value and RLS policies exist from day one (read household data, write plans), but invitations offer only `caregiver` and `viewer` until coach accounts ship in Phase 2. |
| Plan generation execution | `ai-generate-plan` enqueues to the pgmq queue `plan_generation`; its `/worker` sub-route processes stages and writes progress to `meal_plans.generation_progress`, streamed to the app over Realtime. |
| Recommendation publishing | A recommendation is shown to users only when it links to at least one verified Islamic source **and** one scientific evidence row, unless it is flagged `science_only` (pure nutrition guidance with no Islamic claim). |
| Schema additions | Tables and columns that other documents mark as "Addition beyond 00-foundations" are accepted. They are collected into follow-up migrations in Sprint 0 (story in `24-sprint-plan.md`), and `05-database-schema.md` is the place they land. |
| Store reviewer access | Supabase test OTPs cover phone numbers, not email, so the reviewer account `reviewer@thuluth.app` signs in with a password instead. The password is set by an admin; the app reveals a password field only when that exact address is entered; a Supabase "before user created" Auth hook rejects any other password sign-up. Verify the hook behaviour in Sprint 0 (see `11-authentication.md` section 3.1.1). |
| Plan status after generation | Generation finishes at `draft`. The first plan created during onboarding is activated automatically by the app calling `activate_meal_plan`; every later plan shows a review screen and becomes `active` when the user taps "Start this plan". |
| Coach permissions (Phase 2) | Coaches read household data for the members the owner grants and write plans for them; RLS in `05-database-schema.md` is the reference. |
| JS bundle budget | 6 MB of Hermes bytecode, enforced as a PR check (`21-testing-strategy.md`). |
| Free-tier chat model (Sprint 0) | Route key `chat.free` (Anthropic `claude-haiku-4-5-20251001`, Gemini Flash fallback) serves free-tier chat; premium uses `chat.default`. Implements the default for open decision 1 until pricing is revisited after beta. |
| Smoke Edge Function (Sprint 0) | `ai-smoke` sends one prompt through `chat.default` and meters `ai_usage`, for the hidden debug screen. Disabled when `APP_ENV=production`, capped at 10 calls per user per day, and removed once `ai-chat` ships in Sprint 5. |

### Decisions still open for the product owner

1. **AI unit economics.** `04-system-architecture.md` estimates AI cost near or above premium revenue at 100k MAU without controls. Default: ship with the tier caps in `12-ai-agent-architecture.md` and route free-tier chat to the cheapest model, then revisit pricing after beta.
2. **Ramadan timing.** Ramadan 1448 begins around 8 February 2027, one week after the planned launch. Default: the Ramadan planner ships in Sprint 5 and is the launch headline.
3. **Translation licences.** English Qur'an translation (default The Clear Quran if licensable, else Pickthall) and Urdu translation need legal clearance.
4. **Scholar review.** Shia narration references in `13-islamic-knowledge-module.md` and several Sunni reference numbers are flagged for verification before seeding as `verified`.
5. **Legal review.** Pakistan's data protection bill is not yet enacted; COPPA and US state health-data stances in `16-security-architecture.md` need counsel.

## 12. Document map

| # | Document | Deliverable |
|---|---|---|
| 00 | `00-foundations.md` | Canonical decisions (this file) |
| 01 | `01-product-requirements.md` | 1. Product Requirements Document |
| 02 | `02-ux-specification.md` | 2. UX Specification (IA, navigation, flows, screen specs) |
| 03 | `03-design-system.md` | 2. UX Specification (design system, typography, color, dark mode, accessibility, RTL) |
| 04 | `04-system-architecture.md` | 3. System Architecture |
| 05 | `05-database-schema.md` | 4. Database Schema |
| 06 | `06-api-specification.md` | 5. API Specification |
| 07 | `07-react-native-folder-structure.md` | 6. React Native Folder Structure |
| 08 | `08-component-architecture.md` | 7. Component Architecture |
| 09 | `09-state-management.md` | 8. Zustand Store Design |
| 10 | `10-supabase-structure.md` | 9. Supabase Structure |
| 11 | `11-authentication.md` | 10. Authentication Design |
| 12 | `12-ai-agent-architecture.md` | 11. AI Agent Architecture |
| 13 | `13-islamic-knowledge-module.md` | Islamic Knowledge Module |
| 14 | `14-meal-planning-and-grocery.md` | Meal Planning Engine, Grocery System, pricing, seasonal produce |
| 15 | `15-family-health-modules.md` | Growth, Autism, Picky Eater, Ramadan and Fasting, Hydration modules |
| 16 | `16-security-architecture.md` | 12. Security Architecture |
| 17 | `17-subscription-architecture.md` | 13. Subscription Architecture |
| 18 | `18-exports-and-analytics.md` | Export features and Analytics |
| 19 | `19-deployment-architecture.md` | 14. Deployment Architecture |
| 20 | `20-ci-cd-pipeline.md` | 15. CI/CD Pipeline |
| 21 | `21-testing-strategy.md` | 16. Testing Strategy |
| 22 | `22-mvp-roadmap.md` | 17. MVP Roadmap |
| 23 | `23-phase-2-roadmap.md` | 18. Phase 2 Roadmap |
| 24 | `24-sprint-plan.md` | 19. Development Sprint Plan |
| 25 | `25-future-multi-agent-architecture.md` | 20. Future Multi-Agent Architecture |
