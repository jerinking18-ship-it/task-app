-- LOCAL REVIEW ONLY. Additive storage: no existing task, category or Auth changes.
begin;
create function public.task_app_valid_template_items(items jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
  if items is null or jsonb_typeof(items)<>'array' then return false;end if;
  if jsonb_array_length(items) not between 1 and 20 then return false;end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object' then return false;end if;
    if (select count(*) from jsonb_object_keys(item))<>2 or not(item ? 'title' and item ? 'notes')
      or jsonb_typeof(item->'title')<>'string' or jsonb_typeof(item->'notes')<>'string'
      or char_length(item->>'title') not between 1 and 200 or (item->>'title') !~ '[^[:space:]]'
      or char_length(item->>'notes')>4000 then return false;end if;
  end loop;
  return true;
end;$$;
create table public.task_templates(
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 100 and name ~ '[^[:space:]]'),
  items jsonb not null check(public.task_app_valid_template_items(items)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index task_templates_owner_id on public.task_templates(owner_id,id);
alter table public.task_templates enable row level security;
revoke all on public.task_templates from public,anon,authenticated,service_role;
grant select on public.task_templates to authenticated;
create policy task_templates_member_read on public.task_templates for select to authenticated
  using(owner_id=auth.uid() and public.task_app_can_receive_sync());

-- Writes use one locked statement path, current member identity, and a version.
-- A stable client id makes a lost create response safe to retry without duplicates.
create function public.task_app_save_template(template_id uuid,expected_version timestamptz,template_name text,template_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.account_members;current_template public.task_templates;
  clean_name text:=regexp_replace(template_name,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  member:=public.task_app_current_member();
  if member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
  perform 1 from public.account_members where id=member.id and owner_id=auth.uid() and left_at is null for share;
  if not found then raise exception 'Profile session ended' using errcode='42501';end if;
  if template_id is null or clean_name is null or char_length(clean_name) not between 1 and 100 or not public.task_app_valid_template_items(template_items) then
    raise exception 'Invalid template' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(template_id::text,113));
  select * into current_template from public.task_templates where id=template_id and owner_id=auth.uid() for update;
  if expected_version is null then
    if current_template.id is not null then
      if current_template.name<>clean_name or current_template.items<>template_items then raise exception 'Template changed' using errcode='P0013';end if;
    else
      if exists(select 1 from public.task_templates where id=template_id) then raise exception 'Template unavailable' using errcode='P0013';end if;
      insert into public.task_templates(id,owner_id,name,items) values(template_id,auth.uid(),clean_name,template_items) returning * into current_template;
    end if;
  else
    if current_template.id is null or current_template.updated_at<>expected_version then raise exception 'Template changed' using errcode='P0013';end if;
    update public.task_templates set name=clean_name,items=template_items,
      updated_at=greatest(clock_timestamp(),current_template.updated_at+interval '1 microsecond')
      where id=template_id and owner_id=auth.uid() returning * into current_template;
  end if;
  return jsonb_build_object('id',current_template.id,'name',current_template.name,'items',current_template.items,
    'created_at',current_template.created_at,'updated_at',current_template.updated_at);
end;$$;
create trigger templates_live_sync after insert or update or delete on public.task_templates for each row execute function public.task_app_notify_sync('tasks');
revoke all on function public.task_app_valid_template_items(jsonb),public.task_app_save_template(uuid,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.task_app_save_template(uuid,timestamptz,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
