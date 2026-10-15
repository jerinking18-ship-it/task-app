"""New023 cases. Clock replacement exists only inside this disposable test DB."""
rpc('task_app_setup',"'bootstrap',null",owner)
cats={v['name']:v['id'] for v in json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'name',name))from public.categories where owner_id='{owner}';"))}
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,created_at,expires_at)values('{owner}','{cm}','{cats['Healing Meeting']}',now(),now()+interval '14 days');")
sql(f"insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)values('{owner}','00000000-0000-4000-8000-000000009990','Existing fine','Healing Meeting','{mm}','Sarah',now()-interval '3 days');")
def saved_rows():return sql("select jsonb_build_object('tasks',(select jsonb_agg(to_jsonb(t)order by id)from public.tasks t),'absences',(select jsonb_agg(to_jsonb(a)order by id)from public.account_member_absences a),'fines',(select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f),'totals',(select jsonb_agg(to_jsonb(t)order by owner_id,member_id,completion_year)from public.member_completion_totals t),'activation',(select enabled_at from public.task_fine_configuration));")
before=saved_rows()
grants=sql("select jsonb_object_agg(proname,jsonb_build_object('owner',proowner,'acl',proacl))from pg_proc where oid in('public.task_app_mark_absent(uuid,date,boolean)'::regprocedure,'public.task_app_unmark_absent(uuid,timestamptz,boolean)'::regprocedure);")
sql((root/'supabase/migrations/202610150023_attendance_action_window.sql').read_text())
check('023 changes no tasks, absences, issued fines, totals or activation',saved_rows()==before)
check('existing Mark and Unmark owners and execute privileges preserved',sql("select jsonb_object_agg(proname,jsonb_build_object('owner',proowner,'acl',proacl))from pg_proc where oid in('public.task_app_mark_absent(uuid,date,boolean)'::regprocedure,'public.task_app_unmark_absent(uuid,timestamptz,boolean)'::regprocedure);")==grants)
for role in ['anon','authenticated','service_role']:
 check(role+' cannot execute caller-clock helper',sql(f"select has_function_privilege('{role}','public.task_app_attendance_change_open(text,date,timestamptz)','execute');")=='f')
expect('forged helper time cannot bypass RPC','select public.task_app_attendance_change_open(\'Sunday Service\',null,\'2026-10-18T12:00:00+05:30\');',member,'42501')
for name,day,next_day in [('Sunday Service','2026-10-18','2026-10-19'),('Healing Meeting','2026-10-21','2026-10-22'),('Revival Meeting','2026-10-23','2026-10-24'),('Special Meeting','2026-12-31','2027-01-01')]:
 selected=f"'{day}'::date" if name=='Special Meeting' else 'null'
 for at,want in [(day+'T00:00:00+05:30',True),(day+'T20:59:59.999999+05:30',True),(day+'T21:00:00+05:30',False),(next_day+'T00:00:00+05:30',False)]:
  check(name+' boundary '+at,sql(f"select public.task_app_attendance_change_open('{name}',{selected},'{at}');")==str(want)[0].lower())
check('India Sunday midnight differs from UTC Saturday',sql("select public.task_app_attendance_change_open('Sunday Service',null,'2026-10-17T18:30:00Z');")=='t')
for name,selected,at in [('Sunday Service','null',"'2026-10-17T23:59:59+05:30'"),('Special Meeting',"'2026-12-31'","'2026-12-30T23:59:59+05:30'"),('Special Meeting','null',"'2026-10-18T12:00:00+05:30'"),('Unknown','null',"'2026-10-18T12:00:00+05:30'"),('Sunday Service','null','null'),('Sunday Service','null',"'infinity'"),('Special Meeting',"'infinity'","'2026-10-18T12:00:00+05:30'")]:
 check('invalid/wrong-day window fails closed '+name,sql(f"select public.task_app_attendance_change_open('{name}',{selected},{at});")=='f')

# Replace only built-in clock calls in offline copies of the real RPCs. The
# production migration has no test clock, caller override, setting or bypass.
signatures=['public.task_app_mark_absent(uuid,date,boolean)','public.task_app_unmark_absent(uuid,timestamptz,boolean)','public.task_app_member_state()','public.task_app_take_task(uuid,timestamptz,uuid,boolean)']
definitions={signature:sql(f"select pg_get_functiondef('{signature}'::regprocedure);")for signature in signatures}
sql("create table public.attendance_test_clock(at_time timestamptz not null);insert into public.attendance_test_clock values('2026-10-18T12:00:00+05:30');create function public.attendance_test_now()returns timestamptz language sql volatile set search_path='' as $$select at_time from public.attendance_test_clock$$;revoke all on function public.attendance_test_now()from public,anon,authenticated,service_role;")
for definition in definitions.values():sql(definition.replace('clock_timestamp()','public.attendance_test_now()').replace('statement_timestamp()','public.attendance_test_now()'))
def clock(at):sql(f"update public.attendance_test_clock set at_time='{at}';")
def mark(name,day=None,who=member):return rpc('task_app_mark_absent',f"'{cats[name]}',{repr(day)if day else 'null'},true",who)
def own_absence(state,name,mid=mm):return next(a for a in state['absences']if a['member_id']==mid and a['category_id']==cats[name])
def unmark(a,who=member):return rpc('task_app_unmark_absent',f"'{a['id']}','{a['expires_at']}',true",who)
def mark_query(name,day=None):return f"select public.task_app_mark_absent('{cats[name]}',{repr(day)if day else 'null'},true);"
def unmark_query(a):return f"select public.task_app_unmark_absent('{a['id']}','{a['expires_at']}',true);"
for name,day,next_day in [('Sunday Service','2026-10-18','2026-10-19'),('Healing Meeting','2026-10-21','2026-10-22'),('Revival Meeting','2026-10-23','2026-10-24'),('Special Meeting','2026-10-24','2026-10-25')]:
 selected=day if name=='Special Meeting' else None
 clock(day+'T00:00:00+05:30');a=own_absence(mark(name,selected),name)
 check(name+' mark allowed from midnight',a['meeting_date']==selected)
 clock(day+'T20:59:59+05:30');check(name+' same request before9 remains idempotent',own_absence(mark(name,selected),name)['id']==a['id'])
 returned=unmark(a);check(name+' own Unmark before9 clears current absence',not any(x['id']==a['id']for x in returned['absences']))
 a=own_absence(mark(name,selected),name)
 expect(name+' another member cannot unmark',unmark_query(a),coord,'P0403')
 before_row=sql(f"select to_jsonb(a)from public.account_member_absences a where id='{a['id']}';")
 clock(day+'T21:00:00+05:30');expect(name+' Mark at9 denied',mark_query(name,selected),member,'P0012');expect(name+' Unmark at9 denied',unmark_query(a),member,'P0012')
 clock(next_day+'T12:00:00+05:30');expect(name+' next-day Unmark denied',unmark_query(a),member,'P0012')
 check(name+' closed-window calls preserve absence and next-day status',sql(f"select to_jsonb(a)from public.account_member_absences a where id='{a['id']}';")==before_row and any(x['id']==a['id']for x in rpc('task_app_member_state','',member)['absences']))
 check(name+' absence still clears following midnight',sql(f"select expires_at=('{next_day}'::date+1)::timestamp at time zone 'Asia/Kolkata'from public.account_member_absences where id='{a['id']}';")=='t')

clock('2026-10-18T12:00:00+05:30')
for who,mid in [(owner,ownmember),(coord,cm)]:
 a=own_absence(mark('Sunday Service',who=who),'Sunday Service',mid);unmark(a,who);check('same own-attendance window for role '+who,sql(f"select cancelled_at is not null from public.account_member_absences where id='{a['id']}';")=='t')
expect('anonymous mark remains private',"set role anon;"+mark_query('Sunday Service'),None,'42501')
expect('unverified identity cannot mark',mark_query('Sunday Service'),unverified,'P0403')
expect('Special future date denied',mark_query('Special Meeting','2026-10-20'),member,'P0012')

# Taking a task remains available to a helper; unmark never returns claimed work.
clock('2026-10-25T12:00:00+05:30');a=own_absence(mark('Sunday Service'),'Sunday Service')
fields={'title':'Claim remains assigned','notes':'Offline attendance window test','status':'active','due_date':'2026-10-25','due_time':'23:50','priority':'medium','category_id':cats['Sunday Service'],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
t=rpc('task_app_create_tasks',literal([fields]),owner)[0]
claimed=rpc('task_app_take_task',f"'{t['id']}','{t['updated_at']}','{a['id']}',true",owner);unmark(a)
check('Unmark leaves the helpers claimed occurrence assigned',sql(f"select assigned_to_member_id='{ownmember}'::uuid from public.tasks where id='{t['id']}';")=='t')
check('claim provenance survives new attendance limit',sql(f"select count(*)from public.task_coverage_claims where task_id='{t['id']}'and original_member_id='{mm}';")=='1')

# A request started before9 but blocked on existing row locks must use the
# actual decision time after those locks, not its statement start time.
sql("update public.task_fine_configuration set enabled_at=now()-interval '30 days';")
clock('2026-10-28T20:59:59+05:30')
fields.update(title='Locks cross attendance cutoff',due_date='2026-10-28',category_id=cats['Healing Meeting'])
t=rpc('task_app_create_tasks',literal([fields]),owner)[0]
sql(f"update public.task_fine_candidates set finalized=false where task_id='{t['id']}';")
def crosses_lock(query):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
  holder=pool.submit(sql,f"begin;select task_id from public.task_fine_candidates where task_id='{t['id']}'for update;select pg_sleep(2);commit;")
  time.sleep(.2)
  action=pool.submit(sql,query,member,'P0012')
  for _ in range(12):
   if sql("select exists(select 1 from pg_stat_activity where state='active'and wait_event_type='Lock'and query like '%task_app_%absent%');")=='t':break
   time.sleep(.05)
  else:raise AssertionError('Attendance request did not wait for test lock')
  clock('2026-10-28T21:00:00+05:30');holder.result();action.result()
crosses_lock(mark_query('Healing Meeting'));check('Mark waits across9PM and is denied after lock',sql(f"select count(*)from public.account_member_absences where member_id='{mm}'and category_id='{cats['Healing Meeting']}'and cancelled_at is null and expires_at>'2026-10-28';")=='0')
clock('2026-10-28T20:59:59+05:30');a=own_absence(mark('Healing Meeting'),'Healing Meeting');before_row=sql(f"select to_jsonb(a)from public.account_member_absences a where id='{a['id']}';")
crosses_lock(unmark_query(a));check('Unmark waits across9PM and preserves absence after denial',sql(f"select to_jsonb(a)from public.account_member_absences a where id='{a['id']}';")==before_row)

for signature,definition in definitions.items():sql(definition)
sql('drop function public.attendance_test_now();drop table public.attendance_test_clock;')
verification=sql((root/'supabase/verification/20261015_attendance_action_window_checks.sql').read_text())
check('restored real clock and all public postchecks zero',all(line.rsplit('|',1)[1]=='0'for line in verification.splitlines()))
check('existing1AM fines/history timing unchanged',all(line.rsplit('|',1)[1]=='0'for line in sql((root/'supabase/verification/20261015_exact_meeting_windows_checks.sql').read_text()).splitlines()))
sql((root/'supabase/migrations/202610150023_attendance_action_window.sql').read_text(),fail='already installed')
print('Attendance action window integration passed.',flush=True)
