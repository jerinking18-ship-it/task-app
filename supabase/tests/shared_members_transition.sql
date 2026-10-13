-- DISPOSABLE LOCAL PostgreSQL ONLY, before migration006.
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('sub',auth.uid(),'session_id',nullif(current_setting('request.jwt.claim.session_id',true),''));
$$;
grant execute on function auth.jwt() to anon,authenticated;
create table public.local_members_snapshot as select id,owner_id,title,notes,status,completed_at from public.tasks;
