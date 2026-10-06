-- supabase/migrations/20261006130200_storage_buckets.sql
-- 05 ref: 0015 storage (part: path helpers, meal-photos, chat-attachments), 0016b (voice-notes). Sprint 5: S5-02.
-- Bucket rows and policies from 10 sections 6.1, 6.4 and 6.5, except:
--   * Created only when the storage schema exists (Supabase, or the plain-mode test stub), like the S4 realtime
--     policies. The path helpers are plain SQL and always created.
--   * meal-photos: the self-logging branch (insert and delete) also requires the member in path segment 2 to
--     belong to the household in segment 1, so a linked member cannot write into another household's prefix
--     through their own member id. 10 checks the two segments separately.
--   * chat-attachments: the select and delete policies also require a live session (deleted_at is null) through
--     the chat_sessions RLS that the EXISTS runs under; delete keeps 10's "own session" rule.
--   * voice-notes is in this sprint (README: S5-02 lists it with 0016b) because ai-transcribe (S5-06) needs it.
-- Not here: avatars, exports, recipe-images (10 section 6.4; avatars deferred since S1, exports S6) and the
-- storage-orphan-sweep cron, which calls account-delete (S6).

-- Path helpers (10 section 6.4, addition beyond 00-foundations) ----------------------------------------------------
create or replace function public.path_household_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create or replace function public.path_segment_uuid(p_name text, p_index integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_index) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', p_index)::uuid
  end;
$$;
revoke all on function public.path_household_id(text), public.path_segment_uuid(text, integer) from public, anon;
grant execute on function public.path_household_id(text), public.path_segment_uuid(text, integer)
  to authenticated, service_role;

-- Buckets and policies (Supabase only) -------------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: buckets and storage policies not created';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('meal-photos',      'meal-photos',      false,  8388608, array['image/jpeg','image/webp','image/heic']),
    ('chat-attachments', 'chat-attachments', false, 10485760, array['image/jpeg','image/webp','image/heic',
                                                                    'audio/m4a','audio/mp4','audio/aac','audio/webm']),
    ('voice-notes',      'voice-notes',      false,  5242880, array['audio/m4a','audio/mp4','audio/aac','audio/webm'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Always write objects.name: inside a subquery on family_members a bare name binds to family_members.name.
  -- meal-photos: {household_id}/{family_member_id}/{yyyy}/{mm}/{meal_log_id}.jpg ------------------------------------
  execute $p$
    create policy meal_photos_select on storage.objects for select to authenticated
      using (bucket_id = 'meal-photos' and public.is_household_member(public.path_household_id(objects.name)))
  $p$;
  execute $p$
    create policy meal_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'meal-photos' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (public.is_household_member(public.path_household_id(objects.name))
            and exists (select 1 from public.family_members fm
                         where fm.id = public.path_segment_uuid(objects.name, 2)
                           and fm.household_id = public.path_household_id(objects.name)
                           and fm.linked_user_id = auth.uid()))))   -- self-logging teen/adult
  $p$;
  execute $p$
    create policy meal_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'meal-photos' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or exists (select 1 from public.family_members fm
                    where fm.id = public.path_segment_uuid(objects.name, 2)
                      and fm.household_id = public.path_household_id(objects.name)
                      and fm.linked_user_id = auth.uid())))
  $p$;
  -- no update policy: photos are immutable; re-upload under a new meal_log id

  -- chat-attachments: {household_id}/{chat_session_id}/{uuid}.{ext}, private to the session owner --------------------
  execute $p$
    create policy chat_attachments_select on storage.objects for select to authenticated
      using (bucket_id = 'chat-attachments' and exists (
        select 1 from public.chat_sessions s
        where s.id = public.path_segment_uuid(objects.name, 2)
          and s.household_id = public.path_household_id(objects.name)
          and s.user_id = auth.uid()))
  $p$;
  execute $p$
    create policy chat_attachments_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'chat-attachments' and exists (
        select 1 from public.chat_sessions s
        where s.id = public.path_segment_uuid(objects.name, 2)
          and s.household_id = public.path_household_id(objects.name)
          and s.user_id = auth.uid()
          and s.deleted_at is null))
  $p$;
  execute $p$
    create policy chat_attachments_delete on storage.objects for delete to authenticated
      using (bucket_id = 'chat-attachments' and exists (
        select 1 from public.chat_sessions s
        where s.id = public.path_segment_uuid(objects.name, 2)
          and s.household_id = public.path_household_id(objects.name)
          and s.user_id = auth.uid()))
  $p$;

  -- voice-notes (0016b): {household_id}/{uuid}.m4a, premium uploader only; ai-transcribe deletes after use ------------
  execute $p$
    create policy voice_notes_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'voice-notes'
                  and public.is_household_member(public.path_household_id(objects.name))
                  and public.has_premium(auth.uid()))
  $p$;
  execute $p$
    create policy voice_notes_select_own on storage.objects for select to authenticated
      using (bucket_id = 'voice-notes' and owner_id = auth.uid()::text)
  $p$;
  execute $p$
    create policy voice_notes_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'voice-notes' and owner_id = auth.uid()::text)
  $p$;
end $$;
