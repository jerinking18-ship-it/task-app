-- Read-only; all violation counts must be zero after022.
with examples(category,meeting_day,end_day)as(values
 ('Sunday Service',date '2026-10-18',date '2026-10-19'),
 ('Healing Meeting',date '2026-10-21',date '2026-10-22'),
 ('Revival Meeting',date '2026-10-23',date '2026-10-24'),
 ('Special Meeting',date '2026-10-24',date '2026-10-25'))
select 'fine_cutoffs_01'check_name,count(*)violations from examples
where public.task_app_fine_cutoff(category,meeting_day,'23:50')is distinct from((end_day+time '01:00')at time zone 'Asia/Kolkata')
union all select 'full_final_minute',count(*)from examples where public.task_app_history_expires(category,(meeting_day+time '12:00')at time zone 'Asia/Kolkata',meeting_day,'{}')is distinct from((end_day+1)::timestamp at time zone 'Asia/Kolkata')
union all select 'private_financial_access',count(*)from(values('anon'),('authenticated'),('service_role'))r(role)cross join(values('public.task_fines'),('public.task_fine_candidates'))t(name)where has_table_privilege(role,name,'SELECT,INSERT,UPDATE,DELETE')
union all select 'existing_rpc_access',count(*)from(values('anon'),('authenticated'),('service_role'))r(role)cross join(values('public.task_app_member_history()'),('public.task_app_mark_absent(uuid,date,boolean)'))f(signature)where has_function_privilege(role,signature,'EXECUTE')is distinct from(role='authenticated');
