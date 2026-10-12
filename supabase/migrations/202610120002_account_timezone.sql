-- Reviewed and applied to task-app on 2026-10-12 via the Supabase SQL Editor.
-- Application and verification record: plans/13-account-timezone-plan.md.
-- Creates an empty private settings table; does not initialize any account.
-- Already applied; do not rerun. Existing objects cause an error and rollback.
begin;

create table public.account_settings (
  owner_id uuid primary key default auth.uid()
    references auth.users (id) on delete restrict,
  timezone text not null,
  created_at timestamptz not null default now(),
  -- Initial supported choice only. No global/default account timezone is assigned.
  -- More zones and timezone changes require separately reviewed product/schema work.
  constraint account_settings_timezone_supported check (timezone = 'Asia/Kolkata')
);

alter table public.account_settings enable row level security;

revoke all privileges on table public.account_settings
  from public, anon, authenticated;

grant select on table public.account_settings to authenticated;
grant insert (timezone) on public.account_settings to authenticated;

create policy account_settings_select_own on public.account_settings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy account_settings_insert_own on public.account_settings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- No UPDATE/DELETE access, signup trigger, settings rows, or task/category changes.
-- Later initialization must use the verified user's session, not a service key.
notify pgrst, 'reload schema';
commit;
