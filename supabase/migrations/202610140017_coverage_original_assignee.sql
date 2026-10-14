-- Read-only provenance for absence-taken occurrences. Apply once after016.
begin;
create function public.task_app_coverage_origins() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare own uuid:=public.task_app_workspace_owner();
begin
 if own is null then raise exception 'Verified workspace membership required' using errcode='P0403';end if;
 -- Latest take of this exact occurrence only. A later reassignment to a different
 -- member does not borrow provenance from an earlier helper's claim.
 return (select coalesce(jsonb_agg(jsonb_build_object('task_id',t.id,'version',t.updated_at,
 'member_id',m.id,'member_name',m.name,'taken_by_member_id',latest.taken_by_member_id)order by t.id),'[]'::jsonb)
 from public.tasks t
 join lateral(select c.original_member_id,c.taken_by_member_id from public.task_coverage_claims c
  where c.owner_id=own and c.task_id=t.id order by c.taken_at desc,c.absence_id desc limit 1)latest on true
 join public.account_members m on m.id=latest.original_member_id and m.owner_id=own
 where t.owner_id=own and t.deleted_at is null and t.assigned_to_member_id=latest.taken_by_member_id);
end;$$;
revoke all on function public.task_app_coverage_origins() from public,anon,authenticated,service_role;
grant execute on function public.task_app_coverage_origins() to authenticated;
notify pgrst,'reload schema';
commit;
