-- Additive template Bin. Existing task/template/Auth rows are preserved.
begin;
alter table public.task_templates add column deleted_at timestamptz,
 add column deleted_by_member_id uuid,add column deleted_by_name text,
 add constraint templates_deleted_member_owner foreign key(owner_id,deleted_by_member_id) references public.account_members(owner_id,id),
 add constraint templates_deleted_metadata check(
 (deleted_at is null and deleted_by_member_id is null and deleted_by_name is null) or
 (deleted_at is not null and deleted_by_member_id is not null and deleted_by_name is not null and char_length(deleted_by_name) between 1 and 50));
create index templates_owner_bin on public.task_templates(owner_id,deleted_at desc,id) where deleted_at is not null;
drop policy task_templates_member_read on public.task_templates;
create policy task_templates_member_read on public.task_templates for select to authenticated
 using(owner_id=auth.uid() and deleted_at is null and public.task_app_can_receive_sync());
create or replace function public.task_app_save_template(template_id uuid,expected_version timestamptz,template_name text,template_items jsonb)
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
  if current_template.deleted_at is not null then raise exception 'Template is in Bin' using errcode='P0013';end if;
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

create function public.task_app_remove_template(template_id uuid,expected_version timestamptz,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.account_members;target public.task_templates;
begin
 member:=public.task_app_current_member();
 if member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
 if template_id is null or expected_version is null or confirmed is distinct from true then raise exception 'Confirm template removal' using errcode='23514';end if;
 perform 1 from public.account_members where id=member.id and owner_id=auth.uid() and left_at is null for share;
 if not found then raise exception 'Profile session ended' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(template_id::text,113));
 select * into target from public.task_templates where id=template_id and owner_id=auth.uid() for update;
 if target.id is null or target.deleted_at is not null or target.updated_at<>expected_version then raise exception 'Template changed' using errcode='P0013';end if;
 update public.task_templates set deleted_at=clock_timestamp(),deleted_by_member_id=member.id,deleted_by_name=member.name,
  updated_at=greatest(clock_timestamp(),target.updated_at+interval '1 microsecond') where id=template_id and owner_id=auth.uid() returning * into target;
 return jsonb_build_object('id',target.id,'updated_at',target.updated_at,'deleted_at',target.deleted_at);
end;$$;
create function public.task_app_deleted_templates()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or (public.task_app_current_member()).id is null then raise exception 'Choose your name' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'items',items,'created_at',created_at,
  'updated_at',updated_at,'deleted_at',deleted_at,'deleted_by_name',deleted_by_name) order by deleted_at desc,id)
  from public.task_templates where owner_id=auth.uid() and deleted_at is not null),'[]'::jsonb);
end;$$;
-- Mixed batches are one transaction, including the existing recurrence-safe task
-- actions. A later stale template raises and rolls back every earlier task change.
create function public.task_app_bin_items(operation text,selections jsonb,confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own_id uuid:=auth.uid();member public.account_members;task_items jsonb;template_items jsonb;template_ids uuid[];
 chosen record;valid_count integer;result_items jsonb;
begin
 member:=public.task_app_current_member();
 if own_id is null or member.id is null then raise exception 'Choose your name' using errcode='42501';end if;
 if operation is null or operation not in ('restore','purge') or confirmed is distinct from true or jsonb_typeof(selections) is distinct from 'array'
  or jsonb_array_length(selections) not between 1 and 1000 then raise exception 'Invalid Bin selection' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(selections) e where jsonb_typeof(e)<>'object'
  or (select count(*) from jsonb_object_keys(e))<>3 or e->>'kind' is null or e->>'kind' not in ('task','template')
  or e->>'id' is null or e->>'version' is null) then raise exception 'Invalid Bin item' using errcode='23514';end if;
 if (select count(distinct (e->>'kind', (e->>'id')::uuid)) from jsonb_array_elements(selections) e)<>jsonb_array_length(selections)
  then raise exception 'Duplicate Bin item' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','version',e->>'version')) filter(where e->>'kind'='task'),'[]'::jsonb),
  coalesce(jsonb_agg(e) filter(where e->>'kind'='template'),'[]'::jsonb) into task_items,template_items from jsonb_array_elements(selections) e;
 perform pg_advisory_xact_lock(hashtextextended(own_id::text,90));
 if jsonb_array_length(task_items)>0 then perform public.task_app_bin(operation,task_items,true);end if;
 -- Account Bin lock first, existing task series/row locks second (inside task_app_bin),
 -- selected profile third, template advisory/row locks last. Save/remove take the
 -- profile before a template lock, so a profile revocation or template edit is safe.
 select * into member from public.account_members where owner_id=own_id and left_at is null
  and id=(public.task_app_current_member()).id for update;
 if not found then raise exception 'Profile session ended' using errcode='42501';end if;
 if jsonb_array_length(template_items)>0 then
  select array_agg((e->>'id')::uuid order by (e->>'id')::uuid) into template_ids from jsonb_array_elements(template_items) e;
  for chosen in select unnest(template_ids) as id loop perform pg_advisory_xact_lock(hashtextextended(chosen.id::text,113));end loop;
  perform 1 from public.task_templates where owner_id=own_id and id=any(template_ids) order by id for update;
  select count(*) into valid_count from public.task_templates t join jsonb_array_elements(template_items) e on t.id=(e->>'id')::uuid
   where t.owner_id=own_id and t.deleted_at is not null and t.updated_at=(e->>'version')::timestamptz;
  if valid_count<>cardinality(template_ids) then raise exception 'Bin selection changed' using errcode='P0012';end if;
  if operation='purge' then delete from public.task_templates where owner_id=own_id and id=any(template_ids) and deleted_at is not null;
  else update public.task_templates set deleted_at=null,deleted_by_member_id=null,deleted_by_name=null,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where owner_id=own_id and id=any(template_ids);end if;
 end if;
 select jsonb_agg(jsonb_build_object('kind',e->>'kind','id',e->>'id')) into result_items from jsonb_array_elements(selections) e;
 return jsonb_build_object('action',operation,'items',result_items);
end;$$;
revoke all on function public.task_app_remove_template(uuid,timestamptz,boolean),public.task_app_deleted_templates(),public.task_app_bin_items(text,jsonb,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.task_app_remove_template(uuid,timestamptz,boolean),public.task_app_deleted_templates(),public.task_app_bin_items(text,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
