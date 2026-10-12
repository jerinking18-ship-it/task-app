-- Disposable LOCAL PostgreSQL test only. Expects the bootstrap below and migration.
-- Never run the local bootstrap or these fixture tests against the real project.
begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

-- These helpers run as the caller, never as a privileged definer.
create function pg_temp.assert_true(ok boolean, description text)
returns void language plpgsql security invoker as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', description;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

create function pg_temp.expect_error(statement text, expected_state text, description text)
returns void language plpgsql security invoker as $$
declare caught_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught_state = returned_sqlstate;
  end;
  if caught_state is distinct from expected_state then
    raise exception 'FAIL: %, expected %, received %', description, expected_state, caught_state;
  end if;
  raise notice 'PASS: %', description;
end;
$$;

select pg_temp.assert_true(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.tasks'::regclass, 'public.categories'::regclass)),
  'both tables enable RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.categories (name) values (' Work ');
insert into public.tasks (title, category_id)
  select ' First task ', id from public.categories where name = 'Work';
insert into public.tasks (title) values ('No category');

select pg_temp.assert_true(
  (select count(*) = 2 from public.tasks), 'owner can create/read tasks with or without category');
select pg_temp.assert_true(
  (select title = 'First task' and status = 'active' and priority = 'none'
    and completed_at is null and owner_id = auth.uid()
    from public.tasks where title = 'First task'), 'trim, defaults, and session ownership');

update public.tasks set status = 'completed' where title = 'First task';
select pg_temp.assert_true(
  (select completed_at is not null from public.tasks where title = 'First task'),
  'completion timestamp is assigned');
select set_config('test.completed_at',
  (select completed_at::text from public.tasks where title = 'First task'), true);
update public.tasks set notes = 'Keep completed date' where title = 'First task';
select pg_temp.assert_true(
  (select completed_at = current_setting('test.completed_at')::timestamptz
    from public.tasks where title = 'First task'), 'editing preserves completion timestamp');
update public.tasks set status = 'active' where title = 'First task';
select pg_temp.assert_true(
  (select completed_at is null from public.tasks where title = 'First task'), 'reopening clears completion timestamp');

select pg_temp.expect_error($q$insert into public.categories (name) values ('work')$q$,
  '23505', 'category names unique ignoring case/spaces');
select pg_temp.expect_error($q$insert into public.tasks (title) values (E'\t\n')$q$,
  '23514', 'whitespace-only title denied');
select pg_temp.expect_error($q$insert into public.tasks (title) values (repeat('x', 201))$q$,
  '23514', 'overlong title denied');
select pg_temp.expect_error($q$insert into public.tasks (title, notes) values ('Long notes', repeat('x', 4001))$q$,
  '23514', 'overlong notes denied');
select pg_temp.expect_error($q$insert into public.categories (name) values (repeat('x', 41))$q$,
  '23514', 'overlong category denied');
select pg_temp.expect_error($q$insert into public.tasks (title, due_time) values ('Time only', '09:00')$q$,
  '23514', 'time without date denied');
select pg_temp.expect_error($q$insert into public.tasks (title, status) values ('Bad status', 'pending')$q$,
  '23514', 'unknown status denied');
select pg_temp.expect_error($q$insert into public.tasks (title, priority) values ('Bad priority', 'urgent')$q$,
  '23514', 'unknown priority denied');
select pg_temp.expect_error($q$update public.tasks set owner_id = '00000000-0000-4000-8000-000000000002'$q$,
  '42501', 'ownership changes denied by column privileges');
select pg_temp.expect_error($q$insert into public.tasks (title, owner_id) values ('Forged', '00000000-0000-4000-8000-000000000002')$q$,
  '42501', 'forged task owner denied');
select pg_temp.expect_error($q$insert into public.categories (name, owner_id) values ('Forged', '00000000-0000-4000-8000-000000000002')$q$,
  '42501', 'forged category owner denied');
select pg_temp.expect_error($q$update public.tasks set created_at = now()$q$,
  '42501', 'creation timestamp writes denied');
select pg_temp.expect_error($q$update public.tasks set completed_at = now()$q$,
  '42501', 'completion timestamp writes denied');
select pg_temp.expect_error($q$delete from public.tasks$q$,
  '42501', 'task deletion denied');
select pg_temp.expect_error($q$update public.categories set name = 'Renamed'$q$,
  '42501', 'category renaming denied');
select pg_temp.expect_error($q$delete from public.categories$q$,
  '42501', 'category deletion denied');
select set_config('test.first_category', (select id::text from public.categories limit 1), true);
select set_config('test.first_task', (select id::text from public.tasks where title = 'First task'), true);

-- Second account may reuse the name but cannot see/update/link the first's data.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true((select count(*) = 0 from public.tasks), 'other account sees no tasks');
select pg_temp.assert_true((select count(*) = 0 from public.categories), 'other account sees no categories');
insert into public.categories (name) values ('Work');
insert into public.tasks (title, due_date, due_time, priority, category_id)
  select 'Second account task', '2026-10-12', '09:00', 'high', id from public.categories;
insert into public.tasks (title, due_date, status) values ('Date only completed', '2026-10-12', 'completed');
select pg_temp.assert_true(
  (select completed_at is not null and due_time is null from public.tasks where title = 'Date only completed'),
  'date-only and initially completed tasks work');
with changed as (
  update public.tasks set title = 'Changed by other user'
    where id = current_setting('test.first_task')::uuid returning id
)
select pg_temp.assert_true((select count(*) = 0 from changed),
  'other account update changes zero rows');
select pg_temp.expect_error(
  format('insert into public.tasks (title, category_id) values (%L, %L)', 'Wrong category', current_setting('test.first_category')),
  '23503', 'cross-account category on insert denied');
select pg_temp.expect_error(
  format('update public.tasks set category_id = %L', current_setting('test.first_category')),
  '23503', 'cross-account category on update denied');

-- Exercise RLS write checks independently of the stricter column grants.
reset role;
grant insert (owner_id) on public.tasks, public.categories to authenticated;
grant update (owner_id) on public.tasks to authenticated;
set local role authenticated;
select pg_temp.expect_error($q$insert into public.tasks (title, owner_id) values ('RLS forged', '00000000-0000-4000-8000-000000000001')$q$,
  '42501', 'RLS independently denies foreign task owner');
select pg_temp.expect_error($q$insert into public.categories (name, owner_id) values ('RLS forged', '00000000-0000-4000-8000-000000000001')$q$,
  '42501', 'RLS independently denies foreign category owner');
select pg_temp.expect_error($q$update public.tasks set owner_id = '00000000-0000-4000-8000-000000000001'$q$,
  '23514', 'metadata trigger independently denies ownership changes');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.assert_true((select count(*) = 0 from public.tasks),
  'authenticated role without a user ID cannot read tasks');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error('select * from public.tasks', '42501', 'signed-out task reads denied');
select pg_temp.expect_error('select * from public.categories', '42501', 'signed-out category reads denied');
select pg_temp.expect_error($q$insert into public.tasks (title) values ('Anonymous')$q$,
  '42501', 'signed-out task creation denied');
select pg_temp.expect_error($q$insert into public.categories (name) values ('Anonymous')$q$,
  '42501', 'signed-out category creation denied');
select pg_temp.expect_error($q$update public.tasks set title = 'Anonymous'$q$,
  '42501', 'signed-out updates denied');
select pg_temp.expect_error('delete from public.tasks', '42501', 'signed-out deletion denied');

reset role;
rollback;
