-- Local review only. Extend reusable template items; no existing rows are rewritten.
begin;
create or replace function public.task_app_valid_template_items(items jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if items is null or jsonb_typeof(items) is distinct from 'array' then return false;end if;
 if jsonb_array_length(items) not between 1 and 20 then return false;end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' then return false;end if;
  if not(item ? 'title' and item ? 'notes')
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('title','notes','assignedToId'))
   or jsonb_typeof(item->'title') is distinct from 'string'
   or jsonb_typeof(item->'notes') is distinct from 'string'
   or char_length(item->>'title') not between 1 and 200 or (item->>'title') !~ '[^[:space:]]'
   or char_length(item->>'notes')>4000 then return false;end if;
  if item ? 'assignedToId' and item->'assignedToId'<>'null'::jsonb then
   if jsonb_typeof(item->'assignedToId') is distinct from 'string'
    or (item->>'assignedToId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false;end if;
  end if;
 end loop;
 return true;
end;$$;

create or replace function public.task_app_save_template(template_id uuid,expected_version timestamptz,template_name text,template_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.account_members;item jsonb;
begin
 -- Same workspace lock and current manager check as all existing task assignments.
 m:=public.task_app_require_role(true);
 if not public.task_app_valid_template_items(template_items) then
  raise exception 'Invalid template' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(template_items) loop
  if item->>'assignedToId' is not null and not exists(
   select 1 from public.account_members where owner_id=m.owner_id
    and id=(item->>'assignedToId')::uuid and left_at is null and auth_user_id is not null
  )then raise exception 'Choose an active workspace assignee' using errcode='23514';end if;
 end loop;
 -- Retain the existing atomic save, stable-create retry, version and Bin safeguards.
 return public.task_app_legacy_save_template(template_id,expected_version,template_name,template_items);
end;$$;

revoke all on function public.task_app_valid_template_items(jsonb),public.task_app_save_template(uuid,timestamptz,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.task_app_save_template(uuid,timestamptz,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
