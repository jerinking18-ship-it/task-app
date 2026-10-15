"""027–029 behavior, permission and retention regression cases. Offline only."""
rpc('task_app_setup',"'bootstrap',null",owner)
cats={v['name']:v['id']for v in json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'name',name))from public.categories where owner_id='{owner}';"))}
sunday=cats['Sunday Service']
legacy=sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,created_at,expires_at)values('{owner}','{mm}','{sunday}','2026-10-18T00:00:00+05:30','2026-10-20T00:00:00+05:30')returning id;")
before=sql(f"select to_jsonb(a)from public.account_member_absences a where id='{legacy}';")
# Existing candidate metadata survives upgrade; orphan snapshots default Evening.
seed_fields={'title':'Pre-upgrade Morning','notes':None,'status':'active','due_date':'2026-11-01','due_time':'23:50','priority':'medium','category_id':sunday,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':ownmember,'sunday_service':'morning'}
seed_task=rpc('task_app_create_tasks',literal([seed_fields]),owner)[0]
orphan='00000000-0000-4000-8000-000000009991'
for tid in [seed_task['id'],orphan]:sql(f"insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,available_at,completed,deleted,created_at,finalized)values('{owner}','{tid}','Preserved fine snapshot','{sunday}','Sunday Service','{ownmember}','Existing Owner Name','2026-11-01','2026-11-01T23:50:00+05:30','2026-11-02T01:00:00+05:30',null,false,false,clock_timestamp(),true);")
candidates_before=sql('select jsonb_agg(to_jsonb(c)order by task_id)from public.task_fine_candidates c;')
sql((root/'supabase/migrations/202610150027_sunday_service_absence.sql').read_text())
check('027 preserves every original candidate field',candidates_before==sql("select jsonb_agg(to_jsonb(c)-'sunday_service'order by task_id)from public.task_fine_candidates c;"))
check('candidate backfill retains Morning and orphan Evening',sql(f"select sunday_service from public.task_fine_candidates where task_id='{seed_task['id']}';")=='morning'and sql(f"select sunday_service from public.task_fine_candidates where task_id='{orphan}';")=='evening')
check('027 preserves legacy absence data and expiry',sql(f"select to_jsonb(a)-'sunday_service'-'morning_returned_at'-'evening_returned_at'from public.account_member_absences a where id='{legacy}';")==before)
for role in ['anon','authenticated','service_role']:
 for helper in ['public.task_app_absence_service_covers(public.account_member_absences,text,timestamptz)','public.task_app_service_attendance_open(text,timestamptz)']:
  check(role+' cannot execute private service helper '+helper,sql(f"select has_function_privilege('{role}','{helper}','execute');")=='f')
for hour,morning,evening in [('00:00:00',True,False),('10:59:59.999999',True,False),('11:00:00',False,False),('12:59:59.999999',False,False),('13:00:00',False,True),('20:59:59.999999',False,True),('21:00:00',False,False)]:
 for service,want in [('morning',morning),('evening',evening)]:check(service+' action window '+hour,sql(f"select public.task_app_service_attendance_open('{service}','2026-10-18T{hour}+05:30');")==str(want)[0].lower())
check('Monday attendance changes closed despite active meeting',sql("select public.task_app_service_attendance_open('morning','2026-10-19T09:00:00+05:30');")=='f')
# Replace real clocks only in offline function copies, never production migration.
signatures=['public.task_app_mark_service_absent(uuid,text,boolean)','public.task_app_unmark_service_absent(uuid,timestamptz,text,boolean)','public.task_app_member_state()','public.task_app_available_coverage()','public.task_app_take_task(uuid,timestamptz,uuid,boolean)']
definitions={signature:sql(f"select pg_get_functiondef('{signature}'::regprocedure);")for signature in signatures}
sql("create table public.additions_test_clock(at_time timestamptz);insert into public.additions_test_clock values('2026-10-18T10:00:00+05:30');create function public.additions_test_now()returns timestamptz language sql volatile set search_path=''as $$select at_time from public.additions_test_clock$$;revoke all on function public.additions_test_now()from public,anon,authenticated,service_role;")
for definition in definitions.values():sql(definition.replace('clock_timestamp()','public.additions_test_now()').replace('statement_timestamp()','public.additions_test_now()'))
def clock(at):sql(f"update public.additions_test_clock set at_time='{at}';")
def mark(service,who=member):return rpc('task_app_mark_service_absent',f"'{sunday}','{service}',true",who)
def find_absence(state,service,mid=mm):return next(a for a in state['absences']if a['member_id']==mid and a['category_id']==sunday and a.get('sunday_service')==service)
def unmark(a,service,who=member):return rpc('task_app_unmark_service_absent',f"'{a['id']}','{a['expires_at']}','{service}',true",who)
def absent_service(service,at):return sql(f"select public.task_app_absence_service_covers(a,'{service}','{at}')from public.account_member_absences a where id='{legacy}';")=='t'
check('legacy Sunday covers both services',all(absent_service(s,'2026-10-18T10:00:00+05:30')for s in ['morning','evening']))
state=mark('morning');check('legacy mark retry remains idempotent',len(state['absences'])==1 and state['absences'][0]['id']==legacy)
expect('old Sunday mark fails closed without service',f"select public.task_app_mark_absent('{sunday}',null,true);",member,'23514')
expect('old Sunday unmark fails closed without service',f"select public.task_app_unmark_absent('{legacy}','2026-10-20T00:00:00+05:30',true);",member,'23514')
expect('another member cannot unmark legacy',f"select public.task_app_unmark_service_absent('{legacy}','2026-10-20T00:00:00+05:30','morning',true);",coord,'P0403')
expect('unverified cannot mark',f"select public.task_app_mark_service_absent('{sunday}','morning',true);",unverified,'P0403')
expect('non Sunday scope rejected',f"select public.task_app_mark_service_absent('{cats['Healing Meeting']}','morning',true);",member,'23514')
# Task release, helper scope and immutable claims.
fields={'title':'Sunday scope test','notes':'Offline only','status':'active','due_date':'2026-10-18','due_time':'23:50','priority':'medium','category_id':sunday,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':'morning'}
def create(patch=None):
 value={**fields,**(patch or {})}
 if value['due_date']is None:value['due_time']=None
 return rpc('task_app_create_tasks',literal([value]),owner)[0]
morning=create();evening=create({'sunday_service':'evening'})
covered=rpc('task_app_available_coverage','',owner)
check('both legacy services released',all(any(c['task_id']==t['id']for c in covered)for t in [morning,evening]))
claimed=rpc('task_app_take_task',f"'{morning['id']}','{morning['updated_at']}','{legacy}',true",owner)
a=state['absences'][0];unmark(a,'morning')
check('partial legacy return preserves Evening and row expiry',not absent_service('morning','2026-10-18T10:00:00+05:30')and absent_service('evening','2026-10-18T10:00:00+05:30')and sql(f"select expires_at='2026-10-20T00:00:00+05:30'from public.account_member_absences where id='{legacy}';")=='t')
check('partial legacy return preserves taken helper and claim',sql(f"select assigned_to_member_id='{ownmember}'from public.tasks where id='{morning['id']}';")=='t'and sql(f"select count(*)from public.task_coverage_claims where task_id='{morning['id']}'and absence_id='{legacy}';")=='1')
state=mark('morning');scoped=find_absence(state,'morning');check('new scoped Morning can coexist with legacy Evening',len(state['absences'])==2)
newmorning=create();unmark(scoped,'morning')
covered=rpc('task_app_available_coverage','',owner);check('unmark restores unclaimed Morning only',not any(c['task_id']==newmorning['id']for c in covered)and any(c['task_id']==evening['id']for c in covered))
clock('2026-10-18T11:00:00+05:30')
expect('Morning Mark at11 rejected',f"select public.task_app_mark_service_absent('{sunday}','morning',true);",member,'P0012')
expect('Morning Unmark retry at11 rejected',f"select public.task_app_unmark_service_absent('{scoped['id']}','{scoped['expires_at']}','morning',true);",member,'P0012')
clock('2026-10-18T13:00:00+05:30');legacy_state=next(a for a in rpc('task_app_member_state','',member)['absences']if a['id']==legacy);unmark(legacy_state,'evening')
check('both returned legacy mark hidden without deleting record/history',not rpc('task_app_member_state','',member)['absences']and sql(f"select count(*)from public.account_member_absences where id='{legacy}';")=='1')
# Different Sunday marks may share expiry, without duplicate identities in one service.
state=mark('evening');eve=find_absence(state,'evening');check('scoped Evening expires Tuesday midnight',sql(f"select expires_at='2026-10-20T00:00:00+05:30'from public.account_member_absences where id='{eve['id']}';")=='t')
clock('2026-10-25T10:00:00+05:30');helper_abs=find_absence(mark('morning',coord),'morning',cm)
clock('2026-10-25T14:00:00+05:30');original_abs=find_absence(mark('evening'),'evening')
evening2=create({'due_date':'2026-10-25','sunday_service':'evening'});rpc('task_app_take_task',f"'{evening2['id']}','{evening2['updated_at']}','{original_abs['id']}',true",coord)
check('Morning-absent helper may take Evening task',sql(f"select assigned_to_member_id='{cm}'from public.tasks where id='{evening2['id']}';")=='t')
# Historical fines use service snapshot, not the task's current metadata.
sql("update public.task_fine_configuration set enabled_at='2026-10-01T00:00:00Z';")
fm=create({'due_date':'2026-10-25','sunday_service':'morning','assigned_to_member_id':cm});fe=create({'due_date':'2026-10-25','sunday_service':'evening','assigned_to_member_id':cm})
check('candidate stores occurrence service',sql(f"select sunday_service from public.task_fine_candidates where task_id='{fm['id']}';")=='morning')
sql(f"select public.task_app_finalize_fine('{fm['id']}','2026-10-26T01:00:00+05:30');select public.task_app_finalize_fine('{fe['id']}','2026-10-26T01:00:00+05:30');")
check('Morning absence exempts only Morning at Monday1AM',sql(f"select count(*)from public.task_fines where task_id='{fm['id']}';")=='0'and sql(f"select count(*)from public.task_fines where task_id='{fe['id']}';")=='1')
# Concurrency repeated service marks: one row, both callers converge.
clock('2026-11-01T10:00:00+05:30')
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:states=list(pool.map(lambda _:mark('morning'),range(2)))
check('concurrent marks converge to one scoped absence',len({find_absence(st,'morning')['id']for st in states})==1)
clock('2026-11-01T14:00:00+05:30');mark('evening')
check('two services coexist with same member/category/expiry',len(rpc('task_app_member_state','',member)['absences'])==2)
# A request waiting on candidate locks must use its effective time, not start time.
clock('2026-11-08T10:59:59+05:30');locked=create({'due_date':'2026-11-08'})
def crosses_service_lock(query):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
  holder=pool.submit(sql,f"begin;select task_id from public.task_fine_candidates where task_id='{locked['id']}'for update;select pg_sleep(2);commit;")
  time.sleep(.2);action=pool.submit(sql,query,member,'P0012')
  for _ in range(20):
   if sql("select exists(select 1 from pg_stat_activity where state='active'and wait_event_type='Lock'and query like '%task_app_%service_absent%');")=='t':break
   time.sleep(.05)
  else:raise AssertionError('Service action did not wait on candidate lock')
  clock('2026-11-08T11:00:00+05:30');holder.result();action.result()
crosses_service_lock(f"select public.task_app_mark_service_absent('{sunday}','morning',true);")
check('Morning Mark waiting across11AM denied with no absence',not rpc('task_app_member_state','',member)['absences'])
clock('2026-11-08T10:00:00+05:30');locked_abs=find_absence(mark('morning'),'morning')
clock('2026-11-08T10:59:59+05:30');crosses_service_lock(f"select public.task_app_unmark_service_absent('{locked_abs['id']}','{locked_abs['expires_at']}','morning',true);")
check('Morning Unmark waiting across11AM preserves absence',sql(f"select cancelled_at is null from public.account_member_absences where id='{locked_abs['id']}';")=='t')
# Restore real clocks before installing later changes.
for definition in definitions.values():sql(definition)
sql((root/'supabase/migrations/202610150028_missed_completion_timing.sql').read_text())
signature='public.task_app_complete_missed(uuid,timestamptz,boolean)';definition=sql(f"select pg_get_functiondef('{signature}'::regprocedure);")
sql(definition.replace('clock_timestamp()','public.additions_test_now()'))
def missed(t,who=coord):return rpc('task_app_complete_missed',f"'{t['id']}','{t['updated_at']}',true",who)
def reject(t):expect('outside timing blocked with P0014',f"select public.task_app_complete_missed('{t['id']}','{t['updated_at']}',true);",coord,'P0014');check('rejection changes no task/fine',sql(f"select status from public.tasks where id='{t['id']}';")=='active'and sql(f"select count(*)from public.task_fines where task_id='{t['id']}';")=='0')
future=create({'due_date':'2026-12-20'});clock('2026-12-19T23:59:59.999+05:30');reject(future)
clock('2026-12-20T00:00:00+05:30');done=missed(future);check('dated Missed allowed exactly India date midnight',done['status']=='completed'and done['missed_completion_role']=='coordinator')
check('eligible Missed immediate unique50 fine',sql(f"select count(*)from public.task_fines where task_id='{future['id']}'and amount_paise=5000;")=='1')
for category,start,end in [('Sunday Service','2026-12-20','2026-12-22'),('Healing Meeting','2026-12-23','2026-12-25'),('Revival Meeting','2026-12-25','2026-12-27')]:
 t=create({'category_id':cats[category],'sunday_service':'evening'if category=='Sunday Service'else None,'due_date':None})
 clock(start+'T00:00:00+05:30');check(category+' undated opens midnight',sql(f"select public.task_app_missed_timing_open(t,'{category}','{start}T00:00:00+05:30')from public.tasks t where id='{t['id']}';")=='t')
 check(category+' undated full last minute',sql(f"select public.task_app_missed_timing_open(t,'{category}','{end}T00:00:00+05:30'::timestamptz-interval '1 microsecond')from public.tasks t where id='{t['id']}';")=='t')
 clock(end+'T00:00:00+05:30');reject(t)
special=create({'category_id':cats['Special Meeting'],'sunday_service':None,'due_date':None,'weekdays':[3]})
clock('2026-12-25T00:00:00+05:30');reject(special)
clock('2026-12-24T12:00:00+05:30');missed(special);check('Special selected weekday allows following day',sql(f"select status from public.tasks where id='{special['id']}';")=='completed')
sql(definition)
# Existing records/fines/totals survive migration installation; cleanup stays off.
oldregular=create({'category_id':cats['Special Meeting'],'sunday_service':None,'due_date':None});clock('2026-12-24T12:00:00+05:30')
# Normal self completion preserves the established author/annual credit.
rpc('task_app_mutate',f"'{oldregular['id']}','{oldregular['updated_at']}','status',null,'completed','this',null",member)
# Seed old completion timestamps only in this disposable test DB.
def age(t,days):
 sql(f"alter table public.tasks disable trigger user;update public.tasks set completed_at=statement_timestamp()-interval '{days} days'where id='{t['id']}';alter table public.tasks enable trigger user;")
age(oldregular,8)
rows_before=sql('select jsonb_agg(to_jsonb(t)order by id)from public.tasks t;')
sql((root/'supabase/migrations/202610150029_regular_completed_retention.sql').read_text())
check('retention migration itself deletes nothing',rows_before==sql('select jsonb_agg(to_jsonb(t)order by id)from public.tasks t;'))
check('retention disabled until separate approved activation',sql('select enabled_at is null from public.task_retention_configuration;')=='t'and sql('select public.task_app_purge_history();')=='0')
for role in ['anon','authenticated','service_role']:
 check(role+' cannot enable or execute retention',sql(f"select has_table_privilege('{role}','public.task_retention_configuration','update')or has_function_privilege('{role}','public.task_app_purge_history()','execute');")=='f')
# Create recently completed and recoverable Bin records; preserve issued fine.
recent=create({'due_date':None});rpc('task_app_mutate',f"'{recent['id']}','{recent['updated_at']}','status',null,'completed','this',null",member);age(recent,6)
bin_task=create({'due_date':None});rpc('task_app_mutate',f"'{bin_task['id']}','{bin_task['updated_at']}','status',null,'completed','this',null",member);age(bin_task,9)
sql(f"update public.tasks set deleted_at=clock_timestamp()where id='{bin_task['id']}';")
repeat=create({'due_date':'2026-12-20','repeat_rule':'weekly','weekdays':[0]});rpc('task_app_mutate',f"'{repeat['id']}','{repeat['updated_at']}','status',null,'completed','this',null",member);age(repeat,8)
age(future,8) # Missed regular task has an issued fine that must survive deletion.
credits=sql('select jsonb_agg(to_jsonb(t)order by owner_id,member_id,completion_year)from public.member_completion_totals t;')
fines=sql('select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f;')
sql('update public.task_retention_configuration set enabled_at=clock_timestamp();')
removed=int(sql('select public.task_app_purge_history();'));check('enabled cleanup removes old existing regular completions',removed>=2 and sql(f"select count(*)from public.tasks where id in('{oldregular['id']}','{future['id']}');")=='0')
check('cleanup preserves recent, Bin and repeat occurrence',sql(f"select count(*)from public.tasks where id in('{recent['id']}','{bin_task['id']}','{repeat['id']}');")=='3')
check('cleanup preserves annual totals and fine history',credits==sql('select jsonb_agg(to_jsonb(t)order by owner_id,member_id,completion_year)from public.member_completion_totals t;')and fines==sql('select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f;'))
check('cleanup retry has no further deletion',sql('select public.task_app_purge_history();')=='0')
age(recent,7);check('future qualifying completion removed at7day boundary',sql('select public.task_app_purge_history();')=='1')
# A simultaneous ordinary reopen must win over the cleanup predicate.
race=create({'due_date':None});rpc('task_app_mutate',f"'{race['id']}','{race['updated_at']}','status',null,'completed','this',null",member);age(race,8)
version=sql(f"select updated_at from public.tasks where id='{race['id']}';")
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(sql,f"begin;select public.task_app_mutate('{race['id']}','{version}','status',null,'active','this',null);select pg_sleep(2);commit;",member)
 time.sleep(.2);purger=pool.submit(sql,'select public.task_app_purge_history();');holder.result();removed=purger.result()
check('concurrent reopen prevents permanent cleanup of now-active task',removed=='0'and sql(f"select status from public.tasks where id='{race['id']}';")=='active')
# Established repeating History retention remains30days and still operates.
sql(f"alter table public.tasks disable trigger user;update public.tasks set history_at=statement_timestamp()-interval '31 days'where id='{repeat['id']}';alter table public.tasks enable trigger user;")
check('existing repeating History still purges after30days',sql('select public.task_app_purge_history();')=='1'and sql(f"select count(*)from public.tasks where id='{repeat['id']}';")=='0')
check('all approved additions read-only postchecks zero',all(line.rsplit('|',1)[1]=='0'for line in sql((root/'supabase/verification/20261015_approved_additions_checks.sql').read_text()).splitlines()))
print('All approved additions integration checks passed.',flush=True)
