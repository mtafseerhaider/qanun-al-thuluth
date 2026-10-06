-- supabase/tests/database/rls/140_chat_memory.test.sql
-- S5-02 chat and memory (05 sections 10.2 to 10.4, 15.12, 16.3.5, 22.4; 06 sections 3.8 and 4.1; 12 section 7;
-- FR-CHAT-08, FR-CHAT-11): chat is private to the user who started it, even inside one household; clients
-- read a column subset of chat_messages and never write it; memories are household facts for owner and
-- caregiver; deleting a session or withdrawing ai_processing consent withdraws the memories it sourced;
-- vector recall ranks by similarity and recency; the HNSW index exists and serves nearest-neighbour order;
-- quota counts the chatting user's own messages. Cross-household isolation is in 030.
begin;
select plan(44);

select tests.create_user('cm-owner@test.thuluth.app')  as owner \gset
select tests.create_user('cm-care@test.thuluth.app')   as care \gset
select tests.create_user('cm-viewer@test.thuluth.app') as viewer \gset
select tests.create_user('cm-other@test.thuluth.app')  as other \gset
select tests.create_household(:'other', 'Other home') as other_hid \gset
select tests.seed_household(:'owner', 'Chat home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as owner_session from public.chat_sessions where household_id = :'hid' \gset
select id as owner_msg from public.chat_messages where session_id = :'owner_session' \gset
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset

-- ---- sessions: per-user privacy inside one household ---------------------------------------------------------
select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.chat_sessions (household_id, user_id, title) values (%L, %L, 'Caregiver chat')$$, :'hid', :'care'),
  'a caregiver starts their own session');
select throws_ok(format($$insert into public.chat_sessions (household_id, user_id) values (%L, %L)$$, :'hid', :'owner'),
  '42501', null, 'but cannot start one in another user''s name');
select is((select count(*) from public.chat_sessions where household_id = :'hid'), 1::bigint,
  'the caregiver sees only their own session, not the owner''s');
select is((select count(*) from public.chat_messages where session_id = :'owner_session'), 0::bigint,
  'and none of the owner''s messages');
select is(tests.affected_rows(format($$update public.chat_sessions set title = 'mine now' where id = %L$$, :'owner_session')),
  0::bigint, 'nor rename the owner''s session');
select throws_ok(format($$select public.soft_delete('chat_sessions', %L)$$, :'owner_session'),
  '42501', 'FORBIDDEN', 'nor delete it');
select tests.clear_authentication();

select tests.authenticate_as(:'other');
select throws_ok(format($$insert into public.chat_sessions (household_id, user_id) values (%L, %L)$$, :'hid', :'other'),
  '42501', null, 'a non-member cannot open a session in the household');
select tests.clear_authentication();

select tests.authenticate_as(:'owner');
select is((select count(*) from public.chat_sessions where household_id = :'hid'), 1::bigint, 'the owner sees their own session');
select is((select count(*) from public.chat_messages where session_id = :'owner_session'), 1::bigint, 'and its messages');
select is(tests.affected_rows(format($$update public.chat_sessions set title = 'Suhoor ideas' where id = %L$$, :'owner_session')),
  1::bigint, 'renames it');
select throws_ok(format($$update public.chat_sessions set context_snapshot = '{"x":1}' where id = %L$$, :'owner_session'),
  '42501', null, 'but only the title is client-writable');
select throws_ok(format($$insert into public.chat_messages (session_id, household_id, role, content) values (%L, %L, 'assistant', 'forged')$$, :'owner_session', :'hid'),
  '42501', null, 'clients never write chat_messages');
select throws_ok(format($$select tool_calls from public.chat_messages where id = %L$$, :'owner_msg'),
  '42501', null, 'tool_calls are hidden from clients (06 section 3.8)');
select throws_ok(format($$select tokens_in, model from public.chat_messages where id = %L$$, :'owner_msg'),
  '42501', null, 'so are token counts and the model');
select lives_ok(format($$select id, content, attachments, safety_flags, client_message_id, finish_reason from public.chat_messages where id = %L$$, :'owner_msg'),
  'the visible columns are readable');
select tests.clear_authentication();

-- ---- service-role writes, idempotency key, session touch ------------------------------------------------------
select lives_ok(format($$insert into public.chat_messages (session_id, household_id, role, content, client_message_id, created_at) values (%L, %L, 'user', 'Second question', '0b7e3c52-9d41-4c0e-8a8e-2f5b6c7d8e90', now() + interval '1 minute')$$, :'owner_session', :'hid'),
  'ai-chat stores the user turn with its client_message_id');
select lives_ok(format($$insert into public.chat_messages (session_id, household_id, role, content, client_message_id, finish_reason) values (%L, %L, 'assistant', 'Answer', '0b7e3c52-9d41-4c0e-8a8e-2f5b6c7d8e90', 'complete')$$, :'owner_session', :'hid'),
  'and the assistant reply under the same id');
select throws_ok(format($$insert into public.chat_messages (session_id, household_id, role, content, client_message_id) values (%L, %L, 'user', 'Replay', '0b7e3c52-9d41-4c0e-8a8e-2f5b6c7d8e90')$$, :'owner_session', :'hid'),
  '23505', null, 'a replayed client_message_id is unique per session and role');
select throws_ok(format($$insert into public.chat_messages (session_id, household_id, role, finish_reason) values (%L, %L, 'assistant', 'done')$$, :'owner_session', :'hid'),
  '23514', null, 'finish_reason is a closed set');
select ok((select last_message_at >= now() + interval '59 seconds' from public.chat_sessions where id = :'owner_session'),
  'chat_touch_session moves last_message_at forward');
select throws_ok(format($$insert into public.chat_messages (session_id, household_id, role) values (%L, %L, 'user')$$,
                        :'owner_session', :'other_hid'),
  '23503', null, 'a message must stay in its session''s household');

-- deferred foreign keys (S2 / S3)
select fk_ok('public', 'safety_events', 'chat_message_id', 'public', 'chat_messages', 'id',
  'safety_events.chat_message_id references chat_messages');
select fk_ok('public', 'plan_recommendations', 'chat_message_id', 'public', 'chat_messages', 'id',
  'plan_recommendations.chat_message_id references chat_messages');

-- ---- quota: counts the chatting user's own user turns only ----------------------------------------------------------
select is((select remaining from public.ai_quota_check(:'owner', 'chat.default')), 18,
  'ai_quota_check: the free owner has used 2 of 20 chat messages today');
select is((select remaining from public.ai_quota_check(:'care', 'chat.default')), 20,
  'the caregiver''s quota is untouched by the owner''s chat (FR-HH-06)');
select ok(not has_function_privilege('authenticated', 'public.ai_quota_check(uuid, text)', 'execute'),
  'ai_quota_check is service role only');

-- ---- memories: owner and caregiver read and edit; viewer and outsiders do not --------------------------------------
select id as mem from public.ai_memories where household_id = :'hid' \gset
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.ai_memories where household_id = :'hid'), 0::bigint, 'a viewer cannot read memories');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select is((select count(*) from public.ai_memories where household_id = :'hid'), 1::bigint, 'a caregiver reads memories');
select is(tests.affected_rows(format($$update public.ai_memories set fact = 'Family prefers desi breakfast' where id = %L$$, :'mem')),
  1::bigint, 'and edits a fact');
select throws_ok(format($$update public.ai_memories set embedding = null where id = %L$$, :'mem'),
  '42501', null, 'but not the embedding');
select throws_ok(format($$insert into public.ai_memories (household_id, fact, embedding) values (%L, 'x', array_fill(0::real, array[1536])::extensions.vector)$$, :'hid'),
  '42501', null, 'memories are inserted by ai-chat only');
select tests.clear_authentication();

-- ---- recall: similarity x recency, active rows only ----------------------------------------------------------------
insert into public.ai_memories (household_id, family_member_id, fact, embedding, kind, created_at)
values (:'hid', :'son', 'Son likes guava with salt', array_fill(0.02::real, array[1536])::extensions.vector, 'preference', now() - interval '400 days'),
       (:'hid', null, 'Father works night shifts on Thursdays',
        (select (array_agg(case when g <= 768 then 0.03 else -0.03 end order by g))::real[] from generate_series(1, 1536) g)::extensions.vector,
        'routine', now()),
       (:'hid', null, 'Withdrawn fact', array_fill(0.01::real, array[1536])::extensions.vector, 'context', now());
update public.ai_memories set status = 'withdrawn' where fact = 'Withdrawn fact';
select results_eq(
  format($$select fact from public.match_ai_memories(%L, array_fill(0.01::real, array[1536])::extensions.vector, 6)$$, :'hid'),
  $$values ('Family prefers desi breakfast'::text), ('Son likes guava with salt'::text), ('Father works night shifts on Thursdays'::text)$$,
  'match_ai_memories ranks by similarity with recency decay and skips withdrawn facts');
select is((select count(*)::int from public.match_ai_memories(:'hid', array_fill(0.01::real, array[1536])::extensions.vector, 1)), 1,
  'and honours the limit');
select ok(not has_function_privilege('authenticated', 'public.match_ai_memories(uuid, extensions.vector, integer, uuid)', 'execute'),
  'match_ai_memories is service role only');
select has_index('public', 'ai_memories', 'ai_memories_embedding_hnsw', 'ai_memories has the HNSW index');
select is((select am.amname::text from pg_class c join pg_am am on am.oid = c.relam where c.relname = 'ai_memories_embedding_hnsw'),
  'hnsw', 'the index is HNSW');
create function pg_temp.explain_text(p_sql text) returns text language plpgsql as $f$
declare r record; v text := '';
begin
  for r in execute 'explain ' || p_sql loop v := v || r."QUERY PLAN" || ' '; end loop;
  return v;
end $f$;
set local enable_seqscan = off;
select ok(
  pg_temp.explain_text('select id from public.ai_memories order by embedding operator(extensions.<=>) array_fill(0.01::real, array[1536])::extensions.vector limit 8')
  like '%ai_memories_embedding_hnsw%',
  'nearest-neighbour order uses ai_memories_embedding_hnsw (05 section 21 item 12)');
set local enable_seqscan = on;

-- ---- withdrawal: session delete (FR-CHAT-11), consent withdrawal (12 section 7.2), clear all ----------------------
select tests.authenticate_as(:'owner');
select lives_ok(format($$select public.soft_delete('chat_sessions', %L)$$, :'owner_session'), 'the owner deletes their session');
select tests.clear_authentication();
select is((select status || ':' || (deleted_at is not null)::text from public.ai_memories where id = :'mem'), 'withdrawn:true',
  'the memory sourced from that session is withdrawn');

insert into public.chat_sessions (household_id, user_id) values (:'hid', :'care') returning id as care_session \gset
insert into public.chat_messages (session_id, household_id, role, content) values (:'care_session', :'hid', 'user', 'Note') returning id as care_msg \gset
insert into public.ai_memories (household_id, fact, embedding, source_message_id)
values (:'hid', 'Lunch is packed on school days', array_fill(0.01::real, array[1536])::extensions.vector, :'care_msg')
returning id as care_mem \gset
insert into public.consents (user_id, kind, version) values (:'care', 'ai_processing', '2026-10') returning id as care_consent \gset
update public.consents set withdrawn_at = now() where id = :'care_consent';
select is((select status from public.ai_memories where id = :'care_mem'), 'withdrawn',
  'withdrawing ai_processing withdraws memories from that user''s chats');
select is((select count(*) from public.ai_memories where household_id = :'hid' and deleted_at is null and source_message_id is null), 3::bigint,
  'memories not sourced from that user''s chats are kept');

select tests.authenticate_as(:'viewer');
select throws_ok(format($$select public.clear_ai_memories(%L)$$, :'hid'), '42501', 'FORBIDDEN', 'a viewer cannot clear memories');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select is(public.clear_ai_memories(:'hid'), 3, 'a caregiver clears all live memories (soft delete)');
select is((select count(*) from public.ai_memories where household_id = :'hid'), 0::bigint, 'none are visible afterwards');
select tests.clear_authentication();

select * from finish();
rollback;
