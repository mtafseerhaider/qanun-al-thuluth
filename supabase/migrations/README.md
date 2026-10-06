# supabase/migrations

Forward-only SQL for the Thuluth database. The reference DDL is `docs/05-database-schema.md`
(05). Rules are in `docs/10-supabase-structure.md` section 16. In short: never edit a file
after it reaches `thuluth-dev`, enum changes are additive only, and every new table ships in the
same PR with its RLS policies, `set_updated_at` trigger and a pgTAP test.

Run locally with `tooling/scripts/db-test.sh`. It uses `supabase db reset && supabase test db`
when the CLI and Docker are available, and otherwise falls back to a throwaway plain-Postgres
cluster.

## Numbering

05 numbers its migrations 0001 to 0026. The file timestamps are `20261001000100` to
`20261001002600`, written as if the whole schema shipped at once. In practice the schema ships
one sprint at a time, so this README treats each 05 number as a **logical label**, not a file
slot:

- **Sprint 0** uses the 05 file names and timestamps for the slots it fills. It carries a subset
  of each slot (the table below says which). Nothing has been deployed yet, so these timestamps
  are safe.
- **Every later migration** is created with `supabase migration new <name>` and gets a real UTC
  timestamp, so it always sorts after the files already applied to `thuluth-dev`. Inserting an
  older timestamp would need `db push --include-all`. Worse, a fresh `db reset` would then run
  the inserted file *before* the helpers it depends on (for example 0011, 0013). Each new file
  states its 05 label on line 2, for example `-- 05 ref: 0003 identity (part 2: family_members)`.
- Within a sprint, apply base DDL (the remaining parts of 0003 to 0016) **before** the
  consolidated additions (0017 onward) for the same tables. Across sprints, 0017+ parts keep the
  reserved order below.

## Sprint 0 (applied)

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261001000100_extensions_enums.sql` | 0001 | `pgcrypto`, `citext`, `pg_cron`; all 26 canonical enums | `pg_trgm` (S1), `vector` (S2), `pg_net` (S4) |
| `20261001000200_core_helpers.sql` | 0002 | complete: `set_updated_at`, `life_stage_for_dob` (00 §11 calls it `derive_life_stage`), `age_in_months`, `is_minor`, `compute_bmi`, `is_admin` | none |
| `20261001000300_identity_tenancy.sql` | 0003 | `users`, `households`, `household_members` | `household_invitations`, `family_members` (S1) |
| `20261001000700_ai.sql` | 0007 | `ai_usage`, `ai_model_routes`, `prompt_templates` | `ai_assessments` (S2), `chat_sessions`, `chat_messages`, `ai_memories` (S5) |
| `20261001001000_platform.sql` | 0010 | `subscriptions`, `analytics_events` (partitioned) + default partition, `feature_flags` | `consents`, `audit_log`, `devices` (S1); `notifications`, `notification_preferences` (S4); `exports` (S6) |
| `20261001001100_access_helpers.sql` | 0011 | complete except `is_linked_member` (needs `family_members`, S1) | `is_linked_member` |
| `20261001001200_triggers.sql` | 0012 | `updated_at` loop; timezone validation; household bootstrap; household entitlement; owner protection; `transfer_household_ownership`; `handle_new_auth_user` (users row only); `sync_auth_email` | see "Base DDL still to land" |
| `20261001001300_rls.sql` | 0013 | anon baseline revokes; `apply_household_rls` / `apply_catalog_rls` generators; policies for every Sprint 0 table | policies for later tables ship with them |
| `20261001001400_analytics_cron.sql` | 0014 | `ensure_analytics_partitions`, `drop_old_analytics_partitions`, partitions for the current month plus three; cron jobs `analytics-partitions`, `analytics-retention` | materialized views, retention helpers, `invoke_edge_function`, other cron jobs |

Seeds: `seed/catalog/140_ai_model_routes.sql` and `seed/catalog/160_feature_flags.sql` run in
every environment. `seed/local/000_local_vault.sql` and `seed/local/900_dev_fixtures.sql` run
locally and in CI only.

Sprint 0 additions beyond 00-foundations:

- Route key `chat.free` (Anthropic `claude-haiku-4-5-20251001`, Gemini Flash fallback), enabled.
  It implements the default for open decision 1 (cheapest model for free chat), recorded in
  00 §11.
- Flag `chat.free_route`, enabled.
- Route keys `chat.summarize` and `eval.judge`, from 12 §21.
- `ai-smoke` in `config.toml`.

## Sprint 1 (applied)

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261006090000_identity_households_platform.sql` | 0003 (part 2), 0008 (part), 0010 (part 2), 0011, 0012, 0013 | `household_invitations`, `family_members`, `budget_profiles`, `devices`, `consents`, `audit_log`; `is_linked_member`; `family_members_derive` (life_stage, DOB not in the future), `refresh_life_stages` + cron `refresh-life-stages`, `family_size_sync`; tier limits `enforce_household_entitlement` / `enforce_member_entitlement` (raise `LIMIT_REACHED:<resource>`); `transfer_household_ownership` (same error); `accept_household_invitation` (addition, below); `request_ip_hash`, `audit_row_change`, `audit_log_immutable` and audit triggers on the Sprint 0 tables and the new household tables; `handle_new_auth_user` now copies email, locale, country, timezone and units from sign-up metadata (S1-03; units default to imperial for US, Q-12); RLS for every new table; cron `invitations-cleanup` | `notification_preferences` rows in `handle_new_auth_user` (S4) |
| `20261006090100_food_catalog.sql` | 0001 (part), 0004 (part 1), 0013 (part) | `pg_trgm`; `allergens`, `budget_categories`, `regions`, `ingredients`, `ingredient_allergens`; FK `households.region_id -> regions`; catalog RLS | rest of 0004 (S2, S4) |
| `20261006090200_islamic_knowledge.sql` | 0001 (part), 0006, 0012, 0013 (part) | `vector` (in schema `extensions`); `quran_references`, `hadith_references`, `imam_narrations`, `islamic_sources` (embedding column, no index), `source_verifications`, `scientific_evidence`, `recommendations`, `recommendation_evidence`, `foods_in_narrations`; triggers 15.14, 15.15; RLS 16.3.4 | `coaching_tips` (S6); HNSW index (S2-12) |
| `20261006090300_consolidation_helpers.sql` | 0017 | whole slot | none |
| `20261006090400_security_privacy_consents.sql` | 0022a | `consent_versions`, `has_active_consent()`, `audit_log.action` values `identity.*`, `auth.identities` audit trigger | consent triggers (`child_data` on `family_members`, `health_data`): Sprint 2, with the under-18 guard and the health tables |
| `20261006090500_platform_idempotency_rate_limits.sql` | 0025a | `idempotency_keys`, `rate_limit_buckets` (unlogged), `consume_rate_limit()`, `evaluate_feature_flags()`, cron `idempotency-gc`, `rate-limit-gc` | none |
| `20261006090600_islamic_knowledge_extras.sql` | 0019a | 19.1 to 19.4, `citable_islamic_sources`, `v_knowledge_status`, 19.6 policies; `islamic_sources_public` (addition, below) | `search_islamic_sources()` (0019b, S2-12) |

Seeds (every environment, idempotent upserts, safe to run twice): `seed/catalog/010_allergens.sql`
(EU-14 plus US Big-9, 15 codes), `020_budget_categories.sql`, `030_regions.sql` (Pakistan
provinces and ICT), `040_ingredients.sql` and `050_ingredient_allergens.sql` (150 Pakistan
staples, generated by `tooling/scripts/gen-ingredient-seed.py` from USDA SR28; see the file header
for the source, the `fdc_id` back-fill and the open dietitian, Urdu and scholar reviews).

Deviations from 05, each commented in the migration:

- Tier-limit errors are `LIMIT_REACHED:households` / `LIMIT_REACHED:family_members` (P0001,
  detail JSON with `resource`, `limit`, `current`), the contract in 04, 06, 16, 17 and the edge
  `errors.ts`. 05 uses `ENTITLEMENT_*`.
- Clients cannot insert `household_members`; memberships come only from `household-invite`
  through `accept_household_invitation` (06 §3.1). 05/11 allow an owner insert.
- Owners and caregivers read `household_invitations` (06 §3.1); only owners create or revoke.
- `family_members_derive` also fires when `life_stage` is written, so clients cannot set it.
- `consume_rate_limit` validates its arguments before computing the window (05 divides by zero
  first); the verification sync prefers the triggering row when several rows share a
  transaction timestamp.

Sprint 1 additions beyond 00-foundations:

- `public.accept_household_invitation(p_invitation_id uuid, p_user_id uuid)`: security definer,
  `service_role` only. Locks the invitation, raises `INVITE_INVALID` (missing or revoked),
  `INVITE_ALREADY_ACCEPTED` or `INVITE_EXPIRED` (all P0001), then inserts the membership and
  stamps `accepted_at` / `accepted_by` in one transaction. Used by `household-invite` accept.
- View `public.islamic_sources_public` (security invoker): the user-facing columns of sources that
  are verified with at least two approvals and not retracted. `citable_islamic_sources` also
  needs an embedding, so it stays empty until S2-12.

Notes for later sprints:

- The S4 replacement of `handle_new_auth_user` must keep the Sprint 1 body (email, locale,
  country, timezone, units) and only add the default notification preferences.
- Plain-mode `db-test.sh` now needs `postgresql-16-pgvector`.

## Sprint 2

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261006100000_health_profile_intake.sql` | 0005, 0007 (part), 0009 (part), 0013 (part), 0020a (part), 0021a, 0022a (consent triggers) | `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles` (05 §8), `ai_assessments` (§10.1), `hydration_targets` (§12.2); `households.preferences`, `family_members.lifestyle`; `enforce_child_goal_safety` (S2-03) and a date-of-birth guard; consent triggers `child_data` on `family_members` and `health_data` on the sensitive tables; `set_hydration_target()` (addition); updated_at and keys-only audit triggers; RLS | 0022b encryption (`household_keys`, `*_enc`, `get_note_kek()`), see below |
| `20261006100100_ai_safety_evals.sql` | 0018a | `safety_events` (editors resolve, service role writes), `ai_eval_cases`, `ai_eval_runs`; `ai_usage.prompt_key`, `prompt_version`, `cache_read_tokens`, `cache_write_tokens` | FK `safety_events.chat_message_id` (S5, with `chat_messages`) |
| `20261006100200_recipe_catalog.sql` | 0004 (part 2), 0012 15.13, 0013 16.3.3 (part), 0020a (part) | `recipes`, `recipe_ingredients`, `meals`, `portions` (with `tier`), `meal_alternatives`, `seasonal_produce`; FK `food_preferences.recipe_id`; `ingredients.yield_factors`, `shelf_life_days`, `purchase_units`, `aisle`; `recompute_recipe_nutrition()` and triggers on recipe ingredients, servings and ingredient nutrients; RLS | `price_profiles`, `price_observations` (S4) |
| `20261006100300_knowledge_retrieval.sql` | 0001 (HNSW), 0019b | HNSW on `islamic_sources.embedding`; `recommendations.embedding` + HNSW (addition); embedding invalidation triggers; `search_islamic_sources()` verbatim; `match_knowledge()` (addition, S2-12); evidence-strength guard (FR-ISL-05); `recommendation_completeness()` and cron `recommendation-completeness` (FR-ISL-01, S2-13) | none |

Seeds: `seed/catalog/090_recipes.sql` (100 Pakistani home recipes, generated by
`tooling/scripts/gen-recipe-seed.py` from the 040 ingredients; all `in_review` until a dietitian
verifies them), `100_islamic_sources.sql` (14 Qur'an and 28 Sunni hadith references, all
`unverified`, English descriptions only, `arabic_text` empty pending the corpus import),
`110_scientific_evidence.sql` (32 rows, unreviewed, DOI/PMID left for `knowledge:validate`) and
`120_recommendations.sql` (33 recommendations incl. the adab set, `unverified`, English only).
Read each file header for the open reviews.

Deviations from 05, each commented in the migration:

- The child goal guard raises `P0001 CHILD_RULE:<rule>` (06 §3.2; detail JSON carries `rule`)
  instead of 05's 23514 codes, rejects `weight_gain` as well as `weight_loss` and calorie or
  weekly-weight targets, and also fires when a member with a live weight goal is re-dated to
  under 18. The edge `errors.ts` needs a `CHILD_RULE` mapping to VALIDATION_FAILED.
- 0022b (note encryption) is deferred: the Sprint 2 intake contract stores notes as plaintext and
  no health-notes function exists yet.
- `match_knowledge()` and `search_islamic_sources()` both exist. `match_knowledge` is the
  sprint-plan name and also matches verified recommendations; a recommendation matches when its
  `tradition_scope` overlaps the caller's traditions (13 §7.2 item 4).
- `recipes_catalog_title_key` (unique `lower(title)` for global rows) is the idempotent seed key.

## Sprint 3

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261006110000_meal_plans.sql` | 0008 (part 2), 0012 15.6, 0013 16.3.6 (part), 0016 (part), 0020b, 0026 | `meal_plans`, `daily_meals`, `daily_meal_servings`, `plan_recommendations`; `daily_meals.batch_multiplier`, `source_daily_meal_id`, `is_lunchbox`; `meal_plans.weekly_themes`, `generation_progress`; `enforce_plan_entitlement`; RLS and 06 section 3.3 column grants; Realtime (`meal_plans`, `daily_meal_servings`); pgmq queue `plan_generation` (when available), `plan_generation_enqueue/read/ack`, `write_plan_week`, `activate_meal_plan` | `plan-generation-sweeper` cron (needs `invoke_edge_function`, S4); FK `plan_recommendations.chat_message_id` (S5); `ai_jobs` (0018b); grocery and budget tables (S4) |
| `20261006110100_catalog_review_gating.sql` | 0004 (part 3), 0013 16.3.3 (replaced) | `meals.code`, `review_status` on `meals`, `portions`, `meal_alternatives`; `catalog_review_statuses()`; catalog policies rebuilt on it; `daily_meals.swapped_from_meal_id`; `swap_daily_meal()` (S3-13) | none |

Seeds: `seed/catalog/090_recipes.sql` now holds 200 recipes (S3-16); `092_meals.sql` (147 family meals with
stable codes, 170 autism / picky variants, 998 reference servings per recipe and life stage, 2853 meal
portions, 188 meal alternatives) and `095_seasonal_produce.sql` (420 Punjab rows from 14 section 15), all
generated by `tooling/scripts/gen-recipe-seed.py` and all `in_review` / pending ops review; flag
`catalog.include_in_review` (disabled) in `160_feature_flags.sql`. Read each file header for the open reviews.

Deviations from 05, each commented in the migration:

- The plan limit raises the 06 codes `PLAN_ALREADY_ACTIVE` (detail `resource`, `limit`, `current`) and
  `PREMIUM_REQUIRED` (multi-week or non-standard kind), not `ENTITLEMENT_PLAN_LIMIT`. The trigger also fires
  on `deleted_at` (restoring a soft-deleted active plan). The edge `errors.ts` needs mappings for both.
- pgmq is optional: the queue is created only when the extension is available (Supabase); the plain test
  cluster has none, so the wrappers raise `QUEUE_UNAVAILABLE`. `activate_meal_plan` raises `FORBIDDEN` when
  RLS hides the row from its update.
- Additions: `meals.code`; `review_status` on `meals`, `portions` and `meal_alternatives`; the
  internal-alpha gate `catalog_review_statuses()`: `{verified}`, or `{verified,in_review}` while flag
  `catalog.include_in_review` is enabled and the database setting `app.environment` is explicitly
  `local`, `development`, `staging` or `test`. Unset or unknown values fail closed (production needs
  nothing). thuluth-dev and thuluth-staging opt in once with
  `alter database postgres set app.environment = 'development'` / `'staging'`; `seed/local/900_dev_fixtures.sql`
  sets `local` (new sessions); pgTAP tests set it per transaction with `set_config`. The gate covers recipes, meals, portions and alternatives only; Islamic sources and
  recommendations keep their scholar-verified-only policies. Service-role readers (the planning engine)
  filter with `review_status = any(catalog_review_statuses())`.
- Addition: `daily_meals.swapped_from_meal_id` and `swap_daily_meal(p_daily_meal_id, p_alternative_meal_id)`
  (security definer, plan authors only, requires a visible `meal_alternatives` row of the same meal type;
  refuses to drop an allergy or pregnancy adaptation).
- Portions for catalog recipes (`recipe_id` set, tier `standard`, five life stages) are the reference
  serving per life stage; meal portions carry the 14 section 6.3 tiers and are never below the sum of their
  components' reference servings for minors.

## Sprint 4

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261006120000_grocery_budget_prices.sql` | 0004 (part 4), 0008 (part 3), 0012 15.16, 0013 (part), 0014 17.2, 0016 (part), 0020c | `price_profiles`, `price_observations` (0020 screen from the start), `grocery_lists`, `shopping_items`, `budget_entries` (+ currency trigger), `pantry_items`, `ingredient_substitutions`; `mv_ingredient_prices`, `mv_current_prices`, `refresh_ingredient_prices()` (service role); `soft_delete` allow-list + `pantry_items`; Realtime `shopping_items`; `grocery-presence` channel policies (Supabase only) | substitution seed rules (14 section 13.3) |
| `20261006120100_tracking_logs.sql` | 0009 (part 2), 0012 15.10, 15.11, 0013 16.3.7 (part), 0021b, 0022c | `hydration_logs`, `fasting_logs` (unique member + date + kind; `hijri_date`, `qada_for_hijri_year`), `weight_tracking` (adults only, BMI, latest-weight sync, keys-only audit), `nutrition_journal`; `enforce_fasting_safety`; `households.hijri_offset_days`; `fasting_logs_visible`; `v_qada_balance` (S4 body) | `ramadan_plans` (S5); `v_qada_balance` on `ramadan_plans` (S5) |
| `20261006120200_notifications_feedback_cron.sql` | 0001 (pg_net), 0010 (part 3), 0012 15.9, 0013 16.3.8 (part), 0014 17.3 to 17.5, 0016 (part), 0026 (sweeper) | `notifications`, `notification_preferences` (+ `settings`), `notification_kinds()`, `notification_default_enabled()`; full `handle_new_auth_user` + back-fill; `alpha_feedback`; `pg_net` (when available), `private.invoke_edge_function`, `purge_soft_deleted`, `purge_audit_log`; `private.job_leases`, `acquire_job_lease` / `release_job_lease`; cron `notifications-dispatch`, `prices-refresh`, `plan-generation-sweeper`, `soft-delete-purge`, `notifications-retention`, `ai-usage-retention`, `audit-retention`, `cron-history-retention`; Realtime `notifications` | cron `analytics-rollup`, `exports-purge-expired` (S6), `ai-memories-expire` (S5), `account-delete-executor` (S6) |

Seeds: `seed/catalog/080_price_books.sql` (Lahore, Karachi, Islamabad books effective 2026-10-01, 150
ingredients each, 450 `seed` observations; Lahore: 58 prices from the 14 section 16.2 reference basket and 92
estimates; Karachi and Islamabad derived with the 14 section 16.3 multipliers) and
`096_seasonal_produce_sd_is.sql` (Sindh 444 rows with the 14 section 15.3 overrides, ICT 420 rows), both
generated by `tooling/scripts/gen-price-seed.py` (method in its docstring) and pending ops review.

Deviations from 05, each commented in the migration:

- Notification kinds are the 06 section 4.15 list (01 and 02 name it canonical) plus `trial_ending`, on both
  `notifications.kind` and `notification_preferences.kind`; safety kinds `growth_alert` and `allergy_warning`
  cannot be disabled. Addition: `notification_preferences.settings` (per-kind options read by the dispatcher).
- Fasting and weight safety errors use the S2-03 style (P0001): `CHILD_RULE:intermittent_fasting`,
  `CHILD_RULE:fasting_under_7`, `CHILD_RULE:weight_log`, and the addition `FASTING_RULE:intermittent_not_allowed`
  (pregnant or breastfeeding, 15 section 5.8). A logged fast window is at most 24 hours. `exemption_reason`
  allows the 05 and 15 values together (`postpartum`, `chronic_condition`, `medical_advice`).
- `weight_tracking` rejects members under 18 (00 section 10); children use `growth_tracking` (S6).
- `v_qada_balance` reads the Hijri year from `fasting_logs.hijri_date` until `ramadan_plans` lands (S5).
- `invoke_edge_function` sends the Vault `cron_secret` as both `x-internal-secret` (what `_shared/auth.ts`
  checks) and `x-cron-secret` (05/10) and skips with a warning when pg_net or Vault is missing.
  `plan-generation-sweeper` only fires while a plan is `generating`.
- Additions: `price_observations_seed_key` (seed upsert key), FK indexes, `alpha_feedback`, job leases.

## Sprint 5

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261006130000_chat_memory_meal_logs_ramadan.sql` | 0007 (part 3), 0009 (part 3), 0012 15.12, 0013 16.3.5 / 16.3.7 (part), 0014 (part), 0018c, 0021c, 0025b | `chat_sessions` (own only), `chat_messages` (+ `client_message_id`, `finish_reason`, column grants), `chat_touch_session`; `ai_memories` (+ `kind`, `status`, HNSW `ai_memories_embedding_hnsw`), `users.ai_memory_enabled`, `match_ai_memories()`, `clear_ai_memories()`, memory withdrawal on session delete and on `ai_processing` withdrawal; `ai_quota_check()`; `meal_logs` (HE+self); `ramadan_plans` (+ `calc_params`, `ramadan_plans_guard`); `prayer_times_cache`; `v_qada_balance` on `ramadan_plans`; `soft_delete` + linked member's own `meal_logs`; FKs `safety_events.chat_message_id`, `plan_recommendations.chat_message_id`; cron `ai-memories-expire`, `prayer-times-retention` | 12-month memory deletion after downgrade (17 §10.3, S6); `ai_jobs` (0018b) |
| `20261006130100_subscriptions_promos.sql` | 0023 (whole slot), 0011 14.2, 0012 15.6 | `subscriptions` 23.1 columns + unique `(user_id, store, entitlement)`; `has_premium` per 17 (active + 3-day lag, cancelled in period, `in_grace` until grace end; never billing retry, paused, expired, refunded; sandbox only with `allow_sandbox_premium` in an allow-listed `app.environment`); `revenuecat_events`; `promo_campaigns`, `promo_codes`, `promo_redemptions`; `premium_for()`, `get_my_entitlements()`; downgrade: `households.downgrade_kept_at`, `household_is_read_only()`, `keep_household_on_downgrade()`, `enforce_plan_entitlement` refuses plans in read-only households | none |
| `20261006130200_storage_buckets.sql` | 0015 (part), 0016b | `path_household_id()`, `path_segment_uuid()`; buckets `meal-photos`, `chat-attachments`, `voice-notes` and their policies (Supabase only, guarded like the realtime policies; the plain-mode stub in `tooling/scripts/pg-stubs` has a minimal `storage` schema) | buckets `avatars`, `exports`, `recipe-images`; `storage-orphan-sweep` cron (S6) |

Seeds: `seed/catalog/090_recipes.sql` regenerated by `tooling/scripts/gen-recipe-seed.py`: `ramadan_suitable` is
now set by a stated rule (`ramadan_reasons()`: excludes deep-fried, sodium over 900 mg, caffeine, refined flour or
mayonnaise, added sugar over 15 g; qualifies by suhoor slow-release or protein, hydrating, light iftar opener or
light legume main) on 51 of the 200 recipes, which stay `in_review` pending dietitian sign-off.
`seed/catalog/125_ramadan_recommendations.sql`: 20 `rec.ramadan.*` recommendations, `unverified`, English only,
56 evidence links to sources already in 100 and 110 (no new hadith, Qur'an or citation).
`seed/emergency_contacts.json` (12 §8.15; not a table, read by the safety layer): PK, GB, US, CA, AE, SA,
`pending_clinician_review`.

Deviations from 05, each commented in the migration:

- `chat_messages.client_message_id` and `finish_reason` (06 §4.1 idempotent replay); message reads also require
  household membership on the row itself.
- `ramadan_plans` accepts the 06 §4.9 suhoor strategies and the 15 §5.2 prayer-time sources as well as 05's, and
  a guard trigger rejects fasting participation for members under 7 (`CHILD_RULE:fasting_under_7`) and keys that
  are not household members (`VALIDATION_FAILED`).
- `v_qada_balance` takes the Hijri year from the live Ramadan plan and falls back to `fasting_logs.hijri_date`
  outside every plan, instead of dropping those fasts.
- `has_premium`: 17 lifecycle (grace runs past the period end; billing retry is not premium) and fail-closed
  sandbox gating. `household_has_premium` keeps premium following the household owner (FR-HH-06).
- Downgrade (FR-SUB-06) is read-only, never deletion: extra households refuse new plans; logs stay allowed.
- Storage policies qualify `objects.name` (a bare `name` inside a subquery on `family_members` binds to
  `family_members.name`), and the meal-photos self branch ties the member segment to the household segment.

## Base DDL still to land (05 slots 0003 to 0016)

| Sprint | Story | 05 ref | Objects |
|---|---|---|---|
| S1 (landed) | S1-02, S1-03, S1-07 | 0003, 0010, 0011, 0012, 0013 | `household_invitations`, `family_members`, `is_linked_member()`; triggers `family_members_derive`, `family_size_sync`, `enforce_member_entitlement`; `refresh_life_stages()` + cron `refresh-life-stages`; `consents`, `audit_log`, `devices`; `audit_row_change` / `audit_log_immutable` / `request_ip_hash`, plus audit triggers on the Sprint 0 tables (`households`, `household_members`, `subscriptions`, `ai_model_routes`, `prompt_templates`, `feature_flags`); cron `invitations-cleanup` |
| S1 (landed) | S1-10 | 0008 | `budget_profiles` (the optional budget in onboarding step 3) |
| S1 (landed) | S1-19 | 0001, 0004 | `pg_trgm`; `allergens`, `budget_categories`, `regions`, `ingredients`, `ingredient_allergens`; FK `households.region_id -> regions` |
| S1 (landed) | S1-20 | 0006 | `quran_references`, `hadith_references`, `imam_narrations`, `islamic_sources`, `source_verifications`, `scientific_evidence`, `recommendations`, `recommendation_evidence`, `foods_in_narrations`; triggers 15.14, 15.15 |
| S1, deferred (not scheduled) | S1 avatars | 0015 (part) | Storage bucket `avatars` and its policies (10 §6.4); not built in Sprint 1 (no avatar upload yet) |
| S2 (landed) | S2-02 | 0005, 0007, 0009 | `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles`, `ai_assessments`, `hydration_targets`; `enforce_child_goal_safety` (S2-03) |
| S2 (landed) | S2-12 | 0001 | `islamic_sources.embedding` HNSW index (`vector` landed in S1) |
| S2 (landed) | S2-16 | 0004 | `recipes`, `recipe_ingredients`, `meals`, `portions`, `meal_alternatives`, `seasonal_produce`; `recompute_recipe_nutrition` and its trigger |
| S3 (landed) | S3-02 | 0008, 0012, 0016 | `meal_plans`, `daily_meals`, `daily_meal_servings`, `plan_recommendations`; `enforce_plan_entitlement`; Realtime publication (0016) |
| S4 (landed) | S4-02 | 0004, 0008, 0009, 0010, 0012, 0014 | `price_profiles`, `price_observations` (+ moderation trigger), `grocery_lists`, `shopping_items`, `budget_entries` (+ currency trigger), `hydration_logs`, `fasting_logs` (+ `enforce_fasting_safety`), `weight_tracking` (+ BMI and latest-measurement triggers), `nutrition_journal`, `notifications`, `notification_preferences`; full `handle_new_auth_user` body (default preferences); `pg_net`, `invoke_edge_function`, `mv_ingredient_prices`, `refresh_ingredient_prices`, retention helpers, remaining cron jobs |
| S5 (landed) | S5-02 | 0007, 0009, 0012, 0015, 0016b | `chat_sessions`, `chat_messages` (+ `chat_touch_session`), `ai_memories` (HNSW), `meal_logs`, `ramadan_plans`; buckets `chat-attachments`, `meal-photos`, `voice-notes` |
| S6 | S6-02 | 0006, 0009, 0010, 0012 | `growth_reference_lms`, `growth_tracking` (+ reset/sync triggers), `food_exposures`, `exposure_ladders`, `exposure_ladder_steps`, `coaching_tips` (0006 remainder), `exports`; bucket `exports` |
| S6 | S6-13 | 0014 | `mv_daily_active_users`, `mv_feature_usage_daily`, `refresh_analytics_views` (superseded by schema `analytics` in 0024) |

## Reserved follow-up migrations

Every "Addition beyond 00-foundations" in docs 04 to 18 is inventoried below. Each one is
already consolidated as DDL in 05 §22 (0017 to 0026), with traceability in 05 §22.15. Per
00 §11 these additions are accepted, and 05 is where they land, so nothing here needs a docs
change.

The reserved order is 0017 → 0026. A slot whose contents span several sprints is split into
parts (a, b, …). Each part ships in the sprint that first needs it, after that sprint's base
DDL.

| Order | 05 slot | Part / sprint | Contents (requested by) |
|---|---|---|---|
| 1 | 0017 consolidation helpers | **S1** (whole slot), landed | `private.attach_updated_at`, `private.attach_audit` (after the S1 audit functions); `has_household_role(uuid, household_role[])` (11 §18); `has_content_role(text[])` (13 §8.1); `users.age_attested_at` (09, 11), `deletion_scheduled_for` (04, 06), `processing_restricted` (16), `analytics_opt_out`, `is_internal` (18) |
| 2 | 0022 security and privacy | **0022a S1**, landed (consent triggers landed in S2) | `consent_versions`, `has_active_consent()`, consent triggers incl. `child_data` on `family_members` (11 §18, 16 §7.2); `auth.identities` audit trigger, `audit_log.action` values `identity.*` (11 §18) |
| 3 | 0025 platform | **0025a S1**, landed | `idempotency_keys` (04, 06 §2.4), `rate_limit_buckets`, `consume_rate_limit()` (06 §2.7, 16 §20, 00 §11; used by `household-invite` accept), `evaluate_feature_flags()` (09 §12; replaces client-side flag evaluation), `idempotency-gc` and `rate-limit-gc` cron |
| 4 | 0019 Islamic knowledge extras | **0019a S1** (with S1-20), landed | `scholar_reviewers`, `scholarly_notes`, `quran_text`; `islamic_sources.code`, `approvals_count`, `retracted_at`, `retraction_reason`, `search_tsv`; `hadith_references.also_in`; `imam_narrations.edition`, `chapter`, `also_in`; `source_verifications.reviewer_id`, `round`, `action`, `checklist` and widened `method`; `scientific_evidence.code`, `reviewed_by`, `reviewed_on`, `summary_i18n`, `retracted_at`; `recommendations.version`, `tradition_scope`, `science_only` and the relaxed publishing gate (00 §11); two-reviewer verification, retraction; `citable_islamic_sources`, `v_knowledge_status`; content-role policies (12, 13 §13) |
| 5 | 0019 | **0019b S2** (S2-12), landed | `search_islamic_sources()` (12 §9; same as S2-12 `match_knowledge()`, which is the 05 name) |
| 6 | 0018 AI jobs and safety | **0018a S2**, landed | `safety_events` (12 §21; intake red flags); `ai_eval_cases`, `ai_eval_runs` (12 §21, 21 §20); `ai_usage.prompt_key`, `prompt_version`, `cache_read_tokens`, `cache_write_tokens` (12 §21) |
| 7 | 0020 meal planning and grocery extras | **0020a S2** (S2-02, S2-16), landed | `households.preferences` (01 app. B, 14 §22); `ingredients.yield_factors`, `shelf_life_days`, `purchase_units`, `aisle`; `portions.tier` with widened unique keys; recipe nutrition recompute on ingredient edits (14 §22) |
| 8 | 0021 health modules extras | **0021a S2** (S2-02), landed | `family_members.lifestyle` (01 app. B) |
| 9 | 0022 | **0022b S2** (S2-02), deferred (not landed in S2) | `household_keys`, `*_enc` / `*_key_version` columns incl. pregnancy notes, `get_note_kek()` (16 §10, 00 §11: no pgsodium, Vault-held KEK) |
| 10 | 0018 | **0018b S3**, not landed (still open after S5) | `ai_jobs` (12 §21) |
| 11 | 0020 | **0020b S3**, landed | `daily_meals.batch_multiplier`, `source_daily_meal_id`, `is_lunchbox`; `meal_plans.weekly_themes` (14 §22) |
| 12 | 0026 plan generation queue | **S3** (whole slot), landed (sweeper cron in S4) | pgmq queue `plan_generation`, `meal_plans.generation_progress`, queue wrappers, `write_plan_week(uuid, jsonb)`, `activate_meal_plan(uuid)`, `plan-generation-sweeper` cron (04 §15, 06 §3.3 and §9, 00 §11) |
| 13 | 0020 | **0020c S4**, landed | `price_observations.unit_grams`, statuses `rejected_outlier` / `rejected_manual` and the outlier screen; `mv_current_prices`; `pantry_items`; `ingredient_substitutions` (14 §22) |
| 14 | 0021 | **0021b S4**, landed (`v_qada_balance` S4 body) | `households.hijri_offset_days`; `fasting_logs.hijri_date`, `qada_for_hijri_year`; `v_qada_balance` (15 §10) |
| 15 | 0022 | **0022c S4**, landed | `fasting_logs_visible` (16 §5) |
| 16 | 0023 subscriptions and promos | **S5** (whole slot), landed | `subscriptions.entitlement`, `period_type`, `grace_period_expires_at`, `original_transaction_id`, `environment`, `refunded_at`, `country_code`, unique `(user_id, store, entitlement)`; `revenuecat_events`; `promo_campaigns`, `promo_codes`, `promo_redemptions`; `premium_for(uuid)`, `get_my_entitlements(uuid)`; `notification_preferences.kind = 'trial_ending'` (17 §17) |
| 17 | 0018 | **0018c S5**, landed | `ai_memories.kind`, `status`; `chat_messages` column privileges (06 §3.8); `ai_quota_check(uuid, text)` (12 §17; reads `feature_flags['ai.caps']`, already seeded) |
| 18 | 0021 | **0021c S5**, landed (`v_qada_balance` on `ramadan_plans`) | `ramadan_plans.calc_params` (15 §10) |
| 19 | 0025 | **0025b S5**, landed | `prayer_times_cache`, `prayer-times-retention` cron (04, 06 §4.9) |
| 20 | 0021 | **0021d S6** | `growth_tracking.age_days`, `measurement_position`, `entered_by`; `exposure_ladders.status = 'accepted'`, structured `food_exposures.context`; `growth_dashboard(uuid)`, `picky_acceptance_summary(uuid, int)` (15 §10, 18) |
| 21 | 0022 | **0022d S6** | `data_subject_requests`, `deleted_user_ledger` (16 §7.4, §12); erasure executor, `account-delete-executor` cron (04, 06 §4.13) |
| 22 | 0024 analytics | **S6** (whole slot; consider pulling 0024's first block into S1, see note) | `analytics_events.event_id`, `session_id`, `received_at`, `locale`, `country_code`; `analytics_event_catalog`, `track_events(jsonb)`, `analytics_filter_props(text, jsonb)`; schema `analytics` with ten materialized views and `metric_snapshots`; extended `refresh_analytics_views()`; `get_family_insights(uuid, int)` (18 §16) |
| 23 | 0025 | **0025c S6** | `exports.kind = 'account_data'`, nullable `exports.household_id` (04, 06 §4.12) |

Notes:

- **Already covered, not re-added:** 05 §22.13 lists these. Examples: `can_write_household` = `can_edit_household`; `assert_same_household` = composite FKs; `rate_limits` = `rate_limit_buckets`; and the 06 unique index on `notifications (user_id, kind, scheduled_for)`, which is rejected in favour of `dedupe_key`.
- **Not migrations:** route keys (`chat.free`, `chat.summarize`, `eval.judge`) and flag keys are seed rows in `seed/catalog/`. Storage bucket names (04 §15, 10 §17) live in 0015 / 0016b. The `tests` schema is test-only.
- **Phase 2, not reserved:** 05 §22.14 lists these. They include `agent_*` tables (25), `coach_profiles`, `plan_approvals`, `health_integrations`, `packaged_products`, `coaching_programs`, `price_partners`, `households.kind`, `family_members.cohort_size`, the `analytics_reader` role, and `consents.kind = 'partner_access'`.
- **Analytics client contract (S0-13):** until 0024 lands, the client inserts into `analytics_events` directly with `user_id = auth.uid()` (no column default) and `return=minimal` (authenticated has no SELECT). Fields such as `session_id` and `locale` go in `props`. Once 0024 lands, the client switches to `rpc('track_events')`.
- **Generated types:** regenerate `packages/shared/src/db/database.types.ts` with `tooling/scripts/gen-db-types.sh` (postgres-meta, no Docker; usage in the script header). It strips `analytics_events_default` and the monthly `analytics_events_y*m*` partitions, whose names change every month, and formats with the repo Prettier config. A CI drift check (S0-08 / 10 §16 rule 8) that uses `supabase gen types` directly must ignore those tables.
