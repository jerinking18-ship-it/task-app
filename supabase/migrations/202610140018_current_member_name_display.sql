-- Add the stable deletion author identity to the existing private template Bin read.
-- Display code uses current names; stored historical names and records remain untouched.
begin;
create or replace function public.task_app_deleted_templates() returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.account_members;
begin
 member:=public.task_app_require_role(true);
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'items',items,'created_at',created_at,
  'updated_at',updated_at,'deleted_at',deleted_at,'deleted_by_name',deleted_by_name,'deleted_by_member_id',deleted_by_member_id) order by deleted_at desc,id)
  from public.task_templates where owner_id=member.owner_id and deleted_at is not null),'[]'::jsonb);
end;$$;
create function public.task_app_member_names() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare own uuid:=public.task_app_workspace_owner();
begin
 if own is null then raise exception 'Verified workspace membership required' using errcode='P0403';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)order by id)
  from public.account_members where owner_id=own),'[]'::jsonb);
end;$$;
revoke all on function public.task_app_member_names() from public,anon,authenticated,service_role;
grant execute on function public.task_app_member_names() to authenticated;
-- CREATE OR REPLACE preserves the existing function identity and execute grants.
notify pgrst,'reload schema';
commit;
