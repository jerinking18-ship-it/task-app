rpc('task_app_setup',"'bootstrap',null",owner)
cats={v['name']:v['id']for v in json.loads(sql(f"select jsonb_agg(jsonb_build_object('id',id,'name',name))from public.categories where owner_id='{owner}';"))}
sql('select public.task_app_enable_fines();')
sql("create table public.restriction_test_clock(at_time timestamptz);insert into public.restriction_test_clock values('2026-12-20T10:00:00+05:30');create function public.restriction_test_now()returns timestamptz language sql volatile set search_path=''as $$select at_time from public.restriction_test_clock$$;revoke all on function public.restriction_test_now()from public,anon,authenticated,service_role;")
for name in ['task_app_complete_missed','task_app_legacy_before_coverage_mutate','task_app_remove_restriction','task_app_unmark_service_absent','task_app_unmark_absent','task_app_mark_service_absent','task_app_mark_absent','task_app_member_state','task_app_available_coverage','task_app_take_task']:
 definition=sql(f"select pg_get_functiondef(oid)from pg_proc where pronamespace='public'::regnamespace and proname='{name}';")
 sql(definition.replace('clock_timestamp()','public.restriction_test_now()').replace('statement_timestamp()','public.restriction_test_now()'))
def clock(stamp):sql(f"update public.restriction_test_clock set at_time='{stamp}';")
def create(category='Sunday Service',date='2026-12-20',**changes):
 fields={'title':'Fictional restricted work','notes':None,'status':'active','due_date':date,'due_time':'23:50'if date else None,'priority':'medium','category_id':cats[category],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':'morning'if category=='Sunday Service'else None}
 return rpc('task_app_create_tasks',literal([{**fields,**changes}]),owner)[0]
def query(t):return f"select public.task_app_complete_missed('{t['id']}','{t['updated_at']}',true);"
def missed(t,who=coord):return json.loads(sql(query(t),who))
def refresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def status(t,value='completed',who=member,fail=None):
 q=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{value}','this',null);"
 return sql(q,who,fail)if fail else json.loads(sql(q,who))
def restrictions():return json.loads(sql(f"select coalesce(jsonb_agg(a),'[]')from public.account_member_absences a where owner_id='{owner}'and restriction_role is not null and cancelled_at is null;"))
def covers(t,a,stamp):return sql(f"select public.task_app_restriction_covers(t,a,'{stamp}')from public.tasks t,public.account_member_absences a where t.id='{t['id']}'and a.id='{a['id']}';")=='t'
def remove(a,who=coord,fail=None,expires=None):
 q=f"select public.task_app_remove_restriction('{a['id']}','{expires or a['expires_at']}',true);"
 return sql(q,who,fail)if fail else json.loads(sql(q,who))
for service,start,end,nextday in [('morning','09:00','16:00',False),('evening','19:00','01:00',True)]:
 t=create(sunday_service=service)
 for stamp,want in [('2026-12-20T08:59:59+05:30',False),('2026-12-20T09:00:00+05:30',service=='morning'),('2026-12-20T15:59:59+05:30',service=='morning'),('2026-12-20T16:00:00+05:30',False),('2026-12-20T19:00:00+05:30',service=='evening'),('2026-12-21T00:59:59+05:30',service=='evening'),('2026-12-21T01:00:00+05:30',False),('2026-12-27T10:00:00+05:30',False)]:
  check(service+' exact window '+stamp,(sql(f"select public.task_app_missed_timing_open(t,'Sunday Service','{stamp}')from public.tasks t where id='{t['id']}';")=='t')==want)
 sql(f"delete from public.tasks where id='{t['id']}';")
first=create(repeat_rule='weekly',weekdays=[0]);second=create();third=create();evening=create(sunday_service='evening');future=create(date='2026-12-27');old=create(date='2026-12-13');undated=create(date=None)
done=missed(first);a=restrictions()[0]
check('Coordinator Missed creates service-scoped forced absence',a['member_id']==mm and a['sunday_service']=='morning'and a['restriction_role']=='coordinator'and a['restriction_actor_id']==cm and a['expires_at'].startswith('2026-12-21T18:30'))
check('actual attribution and assignment preserved',done['completed_by_member_id']==cm and done['assigned_to_member_id']==mm and done['missed_completion_role']=='coordinator')
check('only remaining current Morning work restricted',covers(second,a,'2026-12-20T10:00+05:30')and covers(undated,a,'2026-12-20T10:00+05:30')and not any(covers(t,a,'2026-12-20T10:00+05:30')for t in [done,evening,future,old]))
check('restriction expires at meeting deadline',not covers(second,a,'2026-12-22T00:00+05:30'))
state=rpc('task_app_member_state','',member)
check('Attendance receives provenance exactly once',len(state['absences'])==1 and state['absences'][0]['restriction_role']=='coordinator')
check('forced absence never releases help coverage',rpc('task_app_available_coverage','',member)==[])
status(second,fail='P0015')
check('ordinary other service completion unaffected',status(evening)['status']=='completed')
check('future and old occurrence normal completion unaffected',status(future)['status']=='completed'and status(old)['status']=='completed')
sql(f"select public.task_app_unmark_service_absent('{a['id']}','{a['expires_at']}','morning',true);",member,fail='P0015')
sql(f"select public.task_app_take_task('{second['id']}','{second['updated_at']}','{a['id']}',true);",owner,fail='P0409')
remove(a,member,fail='P0403');remove(a,outsider,fail='P0409');remove(a,expires='2026-12-23T00:00+05:30',fail='P0409')
# Neither switching to manual absence nor taking another task bypasses a lock.
kept=rpc('task_app_mark_service_absent',f"'{cats['Sunday Service']}','morning',true",member)
check('self-mark cannot replace forced absence with manual coverage',next(x for x in kept['absences']if x['id']==a['id'])['restriction_role']=='coordinator')
owner_absence=rpc('task_app_mark_service_absent',f"'{cats['Sunday Service']}','morning',true",owner)
owner_absence=next(x for x in owner_absence['absences']if x['member_id']==ownmember)
released=create(assigned_to_member_id=ownmember)
sql(f"select public.task_app_take_task('{released['id']}','{released['updated_at']}','{owner_absence['id']}',true);",member,fail='P0403')
check('restricted member cannot Take another released task',refresh(released)['assigned_to_member_id']==ownmember)
# Reopen remains exact actor only; forced absence and unique fine persist.
status(done,'active',owner,fail='P0403');status(done,'active',member,fail='P0403');reopened=status(done,'active',coord)
check('reopen keeps forced restriction',len(restrictions())==1 and covers(reopened,a,'2026-12-20T10:00+05:30'))
done=missed(reopened)
check('recompletion neither duplicates absence nor fine',len(restrictions())==1 and sql(f"select count(*)from public.task_fines where task_id='{done['id']}';")=='1')
check('repeat series assignee and queued occurrence preserved',sql(f"select assigned_to_member_id from public.task_series where id='{first['series_id']}';")==mm and sql(f"select count(*)from public.task_repeat_pending where series_id='{first['series_id']}';")=='1')
# Update payloads cannot bypass the status guard.
fields={'title':second['title'],'notes':None,'status':'completed','due_date':'2026-12-20','due_time':'23:50','priority':'medium','category_id':cats['Sunday Service'],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':'morning'}
sql(f"select public.task_app_mutate('{second['id']}','{second['updated_at']}','update',{literal(fields)},null,'this',null);",owner,fail='P0015')
# Other tasks stay fine-eligible despite forced absence: ₹50 + ₹50 + ₹50.
clock('2026-12-21T01:00:00+05:30')
for t in [second,third]:sql(f"select public.task_app_finalize_fine('{t['id']}','2026-12-21T01:00:00+05:30');")
ids=','.join("'"+t['id']+"'"for t in [first,second,third])
check('3 eligible tasks produce exactly ₹150 despite forced absence',sql(f"select sum(amount_paise)from public.task_fines where task_id in({ids});")=='15000')
sql(f"select public.task_app_finalize_fine('{released['id']}','2026-12-21T01:00:00+05:30');")
check('normal manual absence still exempts its eligible task from fines',sql(f"select count(*)from public.task_fines where task_id='{released['id']}';")=='0')
fine_before=sql(f"select md5(jsonb_agg(f order by id)::text)from public.task_fines f where owner_id='{owner}';")
result=remove(a)
check('manager removal updates attendance and unlocks remaining work',not any(x['id']==a['id']for x in result['absences'])and any(x['id']==owner_absence['id']for x in result['absences'])and status(second)['status']=='completed')
check('removal keeps all fine history',fine_before==sql(f"select md5(jsonb_agg(f order by id)::text)from public.task_fines f where owner_id='{owner}';"))
remove(a) # idempotent confirmation retry
# No hierarchy exemption: Coordinator can record Owner/another Coordinator Missed.
other_invite=invite(7,'coordinator');other_coord=rpc('task_app_accept_invitation',f"'{other_invite['token']}','Other Coordinator'",users[6])['current']['id']
for assignee,who,role in [(ownmember,coord,'coordinator'),(cm,owner,'owner'),(other_coord,coord,'coordinator')]:
 clock('2026-12-23T19:00:00+05:30');t=create('Healing Meeting','2026-12-23',assigned_to_member_id=assignee);d=missed(t,who)
 check('cross-role Missed '+role,d['missed_completion_role']==role and d['assigned_to_member_id']==assignee)
# Normal manual absence still releases work and is never manager-removable.
clock('2026-12-25T10:00:00+05:30');manual=rpc('task_app_mark_absent',f"'{cats['Revival Meeting']}',null,true",member)['absences']
manual=next(x for x in manual if x['category']=='Revival Meeting')
remove({'id':manual['id'],'expires_at':manual['expires_at']},fail='P0409')
t=create('Revival Meeting','2026-12-25')
check('manual absence retains help coverage',sql(f"select public.task_app_absence_covers(t,a,'2026-12-25T10:00+05:30')from public.tasks t,public.account_member_absences a where t.id='{t['id']}'and a.id='{manual['id']}';")=='t')
# The full new RPC rechecks the cutoff after waiting for mutation locks.
clock('2026-12-26T23:59:00+05:30');racing=create('Special Meeting','2026-12-26')
clock('2026-12-27T00:59:59+05:30')
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(sql,f"begin;select task_id from public.task_fine_candidates where task_id='{racing['id']}'for update;select pg_sleep(2);commit;")
 time.sleep(.2);action=pool.submit(sql,query(racing),coord,'P0014')
 for _ in range(30):
  if sql("select exists(select 1 from pg_stat_activity where state='active'and wait_event_type='Lock'and query like '%task_app_complete_missed%');")=='t':break
  time.sleep(.05)
 else:raise AssertionError('Missed request did not wait for candidate lock')
 clock('2026-12-27T01:00:00+05:30');holder.result();action.result()
check('cutoff race creates no completion, fine or forced absence',refresh(racing)['status']=='active'and sql(f"select count(*)from public.task_fines where task_id='{racing['id']}';")=='0'and sql(f"select count(*)from public.account_member_absences where member_id='{mm}'and category_id='{cats['Special Meeting']}';")=='0')
# Private helper and table cannot be invoked or edited directly.
for role in ['anon','authenticated','service_role']:
 check(role+' cannot call restriction matcher',sql(f"select has_function_privilege('{role}','public.task_app_restriction_covers(public.tasks,public.account_member_absences,timestamptz)','execute');")=='f')
sql('select restriction_role from public.account_member_absences;',member,fail='42501')
sql(f"update public.account_member_absences set restriction_role=null where id='{a['id']}';",owner,fail='42501')
check('031 replay refuses atomically',True)
sql((root/'supabase/migrations/202610160031_missed_restricted_absence.sql').read_text(),fail='already exists')
check('new031 read-only postchecks all zero',all(line.rsplit('|',1)[1]=='0'for line in sql((root/'supabase/verification/20261016_restricted_absence_checks.sql').read_text()).splitlines()))
print('PASS all restricted absence SQL checks',flush=True)
