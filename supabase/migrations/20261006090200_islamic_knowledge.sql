-- supabase/migrations/20261006090200_islamic_knowledge.sql
-- 05 ref: 0001 (part: vector), 0006 Islamic knowledge and evidence (all but coaching_tips),
--         0012 triggers 15.14 / 15.15, 0013 RLS 16.3.4 (part). Sprint 1: S1-20.
-- DDL verbatim from 05 section 9. Not here: coaching_tips (S6) and the HNSW index on
-- islamic_sources.embedding (S2-12, created when embeddings are loaded). No content is seeded:
-- every source waits for scholar review (13-islamic-knowledge-module.md).
-- The verified-only view islamic_sources_public and the two-reviewer rules are in the 0019a
-- migration that follows (20261006090600_islamic_knowledge_extras.sql).

create extension if not exists vector with schema extensions;

-- 9.1 quran_references
create table public.quran_references (
  id                uuid primary key default gen_random_uuid(),
  surah             smallint not null check (surah between 1 and 114),
  ayah_start        smallint not null check (ayah_start >= 1),
  ayah_end          smallint not null,
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),  -- {"en":"...","ur":"..."}
  translator        text not null,          -- e.g. 'Sahih International' (en), 'Fateh Muhammad Jalandhari' (ur)
  topic_tags        text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ayah_end >= ayah_start),
  unique (surah, ayah_start, ayah_end)
);
create index quran_references_tags_gin on public.quran_references using gin (topic_tags);

-- 9.2 hadith_references (Sunni collections and shared narrations)
create table public.hadith_references (
  id                uuid primary key default gen_random_uuid(),
  collection        text not null check (collection in (
                      'bukhari','muslim','tirmidhi','abu_dawud','ibn_majah','nasai','ahmad',
                      'malik_muwatta','darimi','bayhaqi','tabarani','hakim','ibn_hibban','other')),
  book              text,                   -- book / chapter name as printed
  number            text not null,          -- text to allow '2022a' style numbering
  numbering_scheme  text not null default 'sunnah_com',  -- Addition: which numbering the number follows
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),
  narrator          text,
  grade             public.evidence_grade_hadith not null default 'ungraded',
  graded_by         text,                   -- e.g. 'al-Albani', 'Shuaib al-Arnaut'
  tradition         public.source_tradition not null default 'sunni',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (collection, numbering_scheme, number)
);

-- 9.3 imam_narrations (narrations of the Twelve Imams, peace be upon them)
create table public.imam_narrations (
  id                uuid primary key default gen_random_uuid(),
  imam              text not null check (imam in (
                      'ali_ibn_abi_talib','hasan_ibn_ali','husayn_ibn_ali','ali_zayn_al_abidin',
                      'muhammad_al_baqir','jafar_al_sadiq','musa_al_kazim','ali_al_rida',
                      'muhammad_al_jawad','ali_al_hadi','hasan_al_askari','muhammad_al_mahdi')),
  collection        text not null check (collection in (
                      'al_kafi','tibb_al_aimma','bihar_al_anwar','wasail_al_shia','al_mahasin',
                      'man_la_yahduruhu_al_faqih','tahdhib_al_ahkam','uyun_akhbar_al_rida',
                      'makarim_al_akhlaq','nahj_al_balagha','other')),
  volume            text,
  page              text,
  number            text,
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),
  grade             public.evidence_grade_hadith not null default 'ungraded',
  graded_by         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(volume, page, number) >= 1)
);
create unique index imam_narrations_locator_key
  on public.imam_narrations (collection, coalesce(volume,''), coalesce(page,''), coalesce(number,''));

-- 9.4 islamic_sources: polymorphic index used for retrieval and citation
create table public.islamic_sources (
  id                   uuid primary key default gen_random_uuid(),
  kind                 public.source_kind not null,
  ref_id               uuid,                 -- id in quran_references / hadith_references / imam_narrations; null for 'scholarly'
  tradition            public.source_tradition not null,
  citation_text        text not null,        -- 'Tirmidhi 2380; Ibn Majah 3349 (sahih, al-Albani)'
  embedding            extensions.vector(1536),
  verification_status  public.verification_status not null default 'unverified',  -- Addition: synced from latest source_verifications row
  topic_tags           text[] not null default '{}',                               -- Addition: retrieval filter
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((kind = 'scholarly') = (ref_id is null))
);
create unique index islamic_sources_ref_key on public.islamic_sources (kind, ref_id) where ref_id is not null;
create index islamic_sources_verified_idx on public.islamic_sources (tradition, kind) where verification_status = 'verified';
create index islamic_sources_tags_gin on public.islamic_sources using gin (topic_tags);
-- islamic_sources_embedding_hnsw: S2-12 (05 section 9.4), with the first embeddings

-- 9.5 source_verifications
create table public.source_verifications (
  id                    uuid primary key default gen_random_uuid(),
  islamic_source_id     uuid not null references public.islamic_sources(id) on delete cascade,
  status                public.verification_status not null,
  reviewer_name         text not null,
  reviewer_credentials  text not null,
  reviewed_on           date not null default current_date,
  method                text not null check (method in ('primary_text_check','takhrij','scholar_panel','cross_reference')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index source_verifications_source_idx on public.source_verifications (islamic_source_id, reviewed_on desc, created_at desc);

-- 9.6 foods_in_narrations
create table public.foods_in_narrations (
  id                 uuid primary key default gen_random_uuid(),
  islamic_source_id  uuid not null references public.islamic_sources(id) on delete cascade,
  ingredient_id      uuid references public.ingredients(id) on delete restrict,
  food_label         text not null,          -- 'talbina', 'dates', 'pumpkin (dubba)'
  context            text not null check (context in ('recommended','mentioned','cautioned')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index foods_in_narrations_source_idx on public.foods_in_narrations (islamic_source_id);
create index foods_in_narrations_ingredient_idx on public.foods_in_narrations (ingredient_id) where ingredient_id is not null;

-- 9.7 scientific_evidence
create table public.scientific_evidence (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  citation    text not null,                -- Vancouver style
  doi         text unique check (doi ~* '^10\.\d{4,9}/\S+$'),
  pmid        text unique check (pmid ~ '^\d{1,9}$'),
  study_type  text not null check (study_type in (
                'systematic_review','meta_analysis','rct','cohort','case_control',
                'cross_sectional','guideline','narrative_review','expert_opinion')),
  grade       public.evidence_grade_science not null,
  summary     text not null,
  population  text,                          -- 'children 2-5 y', 'pregnant women', 'adults with T2D'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index scientific_evidence_title_trgm on public.scientific_evidence using gin (title extensions.gin_trgm_ops);

-- 9.8 recommendations
create table public.recommendations (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[a-z0-9_.]+$'),   -- 'hydration.pre_meal_water'
  title_i18n           jsonb not null check (title_i18n ? 'en'),
  practical_text_i18n  jsonb not null check (practical_text_i18n ? 'en'),
  applies_to           jsonb not null default '{}'::jsonb,
                       -- {"life_stages":["adult"],"modules":["pregnancy"],"goals":["blood_sugar"],"min_age_months":24}
  contraindications    jsonb not null default '{}'::jsonb,
                       -- {"conditions":["ckd"],"medications":["warfarin"],"life_stages":["infant"]}
  review_status        public.verification_status not null default 'unverified',  -- Addition: publish gate
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index recommendations_applies_gin on public.recommendations using gin (applies_to jsonb_path_ops);

-- 9.9 recommendation_evidence
create table public.recommendation_evidence (
  id                      uuid primary key default gen_random_uuid(),
  recommendation_id       uuid not null references public.recommendations(id) on delete cascade,
  islamic_source_id       uuid references public.islamic_sources(id) on delete restrict,
  scientific_evidence_id  uuid references public.scientific_evidence(id) on delete restrict,
  relationship            text not null check (relationship in ('supports','context','caution')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (num_nonnulls(islamic_source_id, scientific_evidence_id) >= 1)
);
create index recommendation_evidence_rec_idx on public.recommendation_evidence (recommendation_id);
create index recommendation_evidence_src_idx on public.recommendation_evidence (islamic_source_id) where islamic_source_id is not null;
create index recommendation_evidence_sci_idx on public.recommendation_evidence (scientific_evidence_id) where scientific_evidence_id is not null;

-- 15.1 updated_at, 15.8 audit (05 audit list: source_verifications, recommendations)
do $$
declare t text;
begin
  foreach t in array array['quran_references','hadith_references','imam_narrations','islamic_sources',
                           'source_verifications','foods_in_narrations','scientific_evidence',
                           'recommendations','recommendation_evidence'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   'trg_' || t || '_updated_at', t);
  end loop;
end $$;
create trigger trg_source_verifications_audit after insert or update or delete on public.source_verifications
  for each row execute function private.audit_row_change('full');
create trigger trg_recommendations_audit after insert or update or delete on public.recommendations
  for each row execute function private.audit_row_change('full');

-- 15.14 Islamic sources integrity (0019a replaces validate_islamic_source and sync_source_verification)
create or replace function private.validate_islamic_source()
returns trigger language plpgsql set search_path = '' as $$
declare v_trad public.source_tradition;
begin
  if new.kind = 'quran' then
    if not exists (select 1 from public.quran_references where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shared';
  elsif new.kind = 'hadith' then
    select tradition into v_trad from public.hadith_references where id = new.ref_id;
    if v_trad is null then raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503'; end if;
    new.tradition := v_trad;
  elsif new.kind = 'imam_narration' then
    if not exists (select 1 from public.imam_narrations where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shia';
  end if;

  if coalesce(current_setting('app.verification_sync', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
    elsif new.verification_status is distinct from old.verification_status then
      raise exception 'VERIFICATION_STATUS_MANAGED' using errcode = '42501',
        hint = 'insert a source_verifications row instead';
    end if;
  end if;
  return new;
end $$;
create trigger trg_islamic_sources_validate before insert or update on public.islamic_sources
  for each row execute function private.validate_islamic_source();

create or replace function private.sync_source_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_source uuid := coalesce(new.islamic_source_id, old.islamic_source_id);
begin
  perform set_config('app.verification_sync', 'on', true);
  update public.islamic_sources s
     set verification_status = coalesce((
           select v.status from public.source_verifications v
            where v.islamic_source_id = s.id
            order by v.reviewed_on desc, v.created_at desc limit 1), 'unverified')
   where s.id = v_source;
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;
create trigger trg_source_verifications_sync after insert or update or delete on public.source_verifications
  for each row execute function private.sync_source_verification();

create or replace function private.reset_verification_on_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind public.source_kind := case tg_table_name
  when 'quran_references' then 'quran' when 'hadith_references' then 'hadith' else 'imam_narration' end;
begin
  perform set_config('app.verification_sync', 'on', true);
  update public.islamic_sources set verification_status = 'in_review'
   where kind = v_kind and ref_id = new.id and verification_status = 'verified';
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;
create trigger trg_quran_references_reverify after update of arabic_text, translation_i18n on public.quran_references
  for each row execute function private.reset_verification_on_edit();
create trigger trg_hadith_references_reverify after update of arabic_text, translation_i18n, grade, number, collection on public.hadith_references
  for each row execute function private.reset_verification_on_edit();
create trigger trg_imam_narrations_reverify after update of arabic_text, translation_i18n, grade, collection, volume, page, number on public.imam_narrations
  for each row execute function private.reset_verification_on_edit();

-- 15.15 recommendation publishing gate (0019a replaces the body)
create or replace function private.enforce_recommendation_publish()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.practical_text_i18n ->> 'en', '') = '' then
    raise exception 'RECOMMENDATION_MISSING_PRACTICAL_TEXT' using errcode = '23514';
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 where re.recommendation_id = new.id and re.scientific_evidence_id is not null) then
    raise exception 'RECOMMENDATION_MISSING_SCIENTIFIC_EVIDENCE' using errcode = '23514';
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 join public.islamic_sources s on s.id = re.islamic_source_id
                 where re.recommendation_id = new.id and s.verification_status = 'verified') then
    raise exception 'RECOMMENDATION_MISSING_VERIFIED_ISLAMIC_SOURCE' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_recommendations_publish before insert or update of review_status on public.recommendations
  for each row when (new.review_status = 'verified')
  execute function private.enforce_recommendation_publish();

-- 16.3.4 RLS: users see verified content only (00-foundations 10.5) -------------------------------------
alter table public.islamic_sources enable row level security;
create policy islamic_sources_select_verified on public.islamic_sources for select to authenticated
  using (verification_status = 'verified' or public.is_admin());
create policy islamic_sources_write_admin on public.islamic_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.quran_references enable row level security;
create policy quran_references_select_verified on public.quran_references for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'quran' and s.ref_id = quran_references.id and s.verification_status = 'verified'));
create policy quran_references_write_admin on public.quran_references for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.hadith_references enable row level security;
create policy hadith_references_select_verified on public.hadith_references for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'hadith' and s.ref_id = hadith_references.id and s.verification_status = 'verified'));
create policy hadith_references_write_admin on public.hadith_references for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.imam_narrations enable row level security;
create policy imam_narrations_select_verified on public.imam_narrations for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'imam_narration' and s.ref_id = imam_narrations.id and s.verification_status = 'verified'));
create policy imam_narrations_write_admin on public.imam_narrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.source_verifications enable row level security;
create policy source_verifications_select on public.source_verifications for select to authenticated
  using (public.is_admin() or (status = 'verified' and exists (select 1 from public.islamic_sources s
         where s.id = islamic_source_id)));
create policy source_verifications_write_admin on public.source_verifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.foods_in_narrations enable row level security;
create policy foods_in_narrations_select on public.foods_in_narrations for select to authenticated
  using (exists (select 1 from public.islamic_sources s where s.id = islamic_source_id));  -- inherits verified filter
create policy foods_in_narrations_write_admin on public.foods_in_narrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
call private.apply_catalog_rls('public.scientific_evidence');
alter table public.recommendations enable row level security;
create policy recommendations_select_verified on public.recommendations for select to authenticated
  using (review_status = 'verified' or public.is_admin());
create policy recommendations_write_admin on public.recommendations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
alter table public.recommendation_evidence enable row level security;
create policy recommendation_evidence_select on public.recommendation_evidence for select to authenticated
  using (public.is_admin() or (
    exists (select 1 from public.recommendations r where r.id = recommendation_id)
    and (islamic_source_id is null or exists (select 1 from public.islamic_sources s where s.id = islamic_source_id))));
create policy recommendation_evidence_write_admin on public.recommendation_evidence for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
