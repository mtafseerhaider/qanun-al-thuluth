-- supabase/seed/local/000_local_vault.sql
-- LOCAL AND CI ONLY. Vault secrets for the local stack (10-supabase-structure.md sections 11 and 14).
-- Hosted environments create these by hand per environment; real values never live in git.
--   project_url    base URL pg_cron uses to call Edge Functions (from inside the db container)
--   cron_secret    compared by Edge Functions to header x-cron-secret
--   audit_ip_salt  salt for audit_log.ip_hash
-- The values below are throwaway local defaults. Skipped when Vault is not installed
-- (plain-Postgres test mode in tooling/scripts/db-test.sh).
do $$
declare
  s record;
begin
  if to_regprocedure('vault.create_secret(text,text,text)') is null then
    raise notice '000_local_vault: vault.create_secret not available, skipping';
    return;
  end if;
  for s in
    select * from (values
      ('project_url',   'http://host.docker.internal:54321', 'Local API gateway for pg_cron -> Edge Functions'),
      ('cron_secret',   'local-cron-secret-not-for-production', 'Local x-cron-secret'),
      ('audit_ip_salt', 'local-audit-ip-salt-not-for-production', 'Local audit IP hash salt')
    ) as v(name, secret, description)
  loop
    if not exists (select 1 from vault.secrets where name = s.name) then
      perform vault.create_secret(s.secret, s.name, s.description);
    end if;
  end loop;
end $$;
