#!/usr/bin/env python3
"""Check-in regressions in disposable, network-isolated PostgreSQL. Never hosted."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'supabase/tests/workspace_assignments.py').read_text().split(' sql(f"update auth.sessions set not_after')[0]
source=source.replace("for path in sorted((root/'supabase/migrations').glob('*.sql')):sql(path.read_text())", "for path in sorted((root/'supabase/migrations').glob('*.sql')):\n  if path.name<'202610180041':sql(path.read_text())")
cases=r'''
rpc('task_app_setup',"'bootstrap',null",owner)
def snapshot():
 return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(to_jsonb(t)order by id)from public.tasks t),'members',(select jsonb_agg(to_jsonb(m)order by id)from public.account_members m),'fines',(select jsonb_agg(to_jsonb(f)order by id)from public.task_fines f),'functions',(select jsonb_agg(jsonb_build_array(oid,proowner,proacl,prosrc)order by oid)from pg_proc where pronamespace='public'::regnamespace and proname not like 'task_app_check_in%'))::text);")
before=snapshot();sql((root/'supabase/migrations/202610180041_meeting_check_in.sql').read_text())
check('migration preserves all old rows functions owners grants',before==snapshot())
# Test-only controlled clock: patch ONLY new definer bodies inside this disposable container.
# The installed production SQL has no public clock override or client-supplied timestamp.
sql("create function public.check_in_test_clock()returns timestamptz language sql stable set search_path=''as $$select current_setting('checkin.clock')::timestamptz$$;revoke all on function public.check_in_test_clock()from public,anon,authenticated,service_role;")
for name in ['public.task_app_check_in_state(boolean)','public.task_app_check_in(uuid,date,text,uuid,boolean)']:
 body=sql(f"select pg_get_functiondef('{name}'::regprocedure);");sql(body.replace('clock_timestamp()','public.check_in_test_clock()'))
real_sql=sql
clock='2026-10-18T10:00:00+05:30'
def sql(query,user=None,fail=None):return real_sql("set checkin.clock='"+clock+"';"+query,user,fail)
def state(who=member,details=False):return rpc('task_app_check_in_state','true'if details else'false',who)
def key(c):return ':'.join([c['categoryId'],c['meetingDate'],c['service']or'',c['meetingId']or''])
def checkin(c,who=member):return rpc('task_app_check_in',f"'{c['categoryId']}','{c['meetingDate']}',"+("'"+c['service']+"'"if c['service']else'null')+','+("'"+c['meetingId']+"'"if c['meetingId']else'null')+',true',who)
def attempt(c):return f"select public.task_app_check_in('{c['categoryId']}','{c['meetingDate']}',"+("'"+c['service']+"'"if c['service']else'null')+','+("'"+c['meetingId']+"'"if c['meetingId']else'null')+',true);'
s=state();morning,evening=s['contexts'];category=morning['categoryId']
check('Sunday has separate Morning and Evening',morning['service']=='morning'and evening['service']=='evening')
check('empty attendance never invents check-ins',s['presence']==[]and s['own']==[])
check('Member state never contains timestamps','entries'not in s and 'checkedAt'not in json.dumps(s))
for stamp,open_m,open_e in [('2026-10-18T06:59:59+05:30',False,False),('2026-10-18T07:00:00+05:30',True,False),('2026-10-18T15:59:59+05:30',True,False),('2026-10-18T16:00:00+05:30',False,True),('2026-10-18T23:59:59+05:30',False,True),('2026-10-19T00:00:00+05:30',False,False)]:
 clock=stamp
 for c,allowed in [(morning,open_m),(evening,open_e)]:
  if allowed:check('window permits '+c['service']+' '+stamp,bool(checkin(c)['state']['own']))
  else:expect('window blocks '+c['service']+' '+stamp,attempt(c),member,'P0016')
clock='2026-10-18T10:00:00+05:30'
first=sql(f"select checked_at from public.task_member_check_ins where member_id='{mm}'and service='morning';")
checkin(morning);check('duplicate keeps first immutable timestamp',first==sql(f"select checked_at from public.task_member_check_ins where member_id='{mm}'and service='morning';"))
check('only current identity is inserted',sql(f"select count(*)from public.task_member_check_ins where member_id='{mm}';")=='2')
check('Owner sees exact private timestamps',len(state(owner,True)['entries'])==2)
check('Coordinator sees exact private timestamps',len(state(coord,True)['entries'])==2)
expect('Member denied private RPC','select public.task_app_check_in_state(true);',member,'P0403')
expect('Member cannot read table timestamps','select checked_at from public.task_member_check_ins;',member,'42501')
expect('Owner cannot directly insert timestamps',f"insert into public.task_member_check_ins(owner_id,member_id,category_id,meeting_date)values('{owner}','{mm}','{category}','2026-10-18');",owner,'42501')
expect('private context helper denied',f"select *from public.task_app_check_in_contexts('{owner}',now());",member,'42501')
expect('anonymous cannot read state','set role anon;select public.task_app_check_in_state(false);',None,'42501')
expect('unverified identity cannot read state','select public.task_app_check_in_state(false);',unverified,'P0403')
expect('unjoined identity cannot read state','select public.task_app_check_in_state(false);',wrong,'P0403')
check('other workspace cannot see member presence',state(outsider)['presence']==[])
expect('foreign category cannot be checked in',attempt(morning),outsider,'P0409')
# Two devices must create one immutable scope row for the same signed-in identity.
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 results=list(pool.map(lambda _:checkin(morning,owner),range(2)))
check('concurrent same-identity check-ins create one row',sql(f"select count(*)from public.task_member_check_ins where member_id='{ownmember}'and service='morning';")=='1')
sql(f"update auth.sessions set not_after=now()-interval '1 second'where id='{sessions[member]}';")
expect('expired session cannot check in',attempt(morning),member,'P0403')
sql(f"update auth.sessions set not_after=null where id='{sessions[member]}';update public.account_members set role='member'where id='{cm}';")
expect('stale Coordinator role cannot read private timestamps','select public.task_app_check_in_state(true);',coord,'P0403')
sql(f"update public.account_members set role='coordinator'where id='{cm}';")
# Existing combined Sunday absence: only the checked service is returned.
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,created_at,expires_at)values('{owner}','{mm}','{category}','2026-10-18 00:00+05:30','2026-10-20 00:00+05:30');")
check('new self-absence makes a previous check-in require return',key(morning)not in state()['own'])
checkin(morning)
check('check-in clears only Morning of legacy combined absence',sql(f"select count(*)from public.account_member_absences where member_id='{mm}'and morning_returned_at is not null and evening_returned_at is null and cancelled_at is null;")=='1')
clock='2026-10-18T22:30:00+05:30';checkin(evening)
check('check-in clears self absence after self-unmark hours',sql(f"select count(*)from public.account_member_absences where member_id='{mm}'and evening_returned_at is not null;")=='1')
sql(f"insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)values('{owner}','{users[14]}','Saved fine','Sunday Service','{mm}','Sarah','2026-10-19 01:00+05:30');")
fine_before=sql('select to_jsonb(f)from public.task_fines f;')
# Manager restriction must not be cleared, even if check-in succeeds.
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,sunday_service,created_at,expires_at,restriction_role,restriction_actor_id)values('{owner}','{mm}','{category}','evening','2026-10-18 20:00+05:30','2026-10-20 00:00+05:30','coordinator','{cm}');")
before_restriction=sql(f"select to_jsonb(a)from public.account_member_absences a where restriction_role is not null;")
checkin(evening)
check('existing issued fine remains byte-identical',fine_before==sql('select to_jsonb(f)from public.task_fines f;'))
check('manager Missed restriction remains byte-identical',before_restriction==sql("select to_jsonb(a)from public.account_member_absences a where restriction_role is not null;"))
clock='2026-10-19T23:59:59+05:30';check('Sunday records retained through Monday',len(state()['presence'])==3)
clock='2026-10-20T00:00:00+05:30';check('Tuesday has no check-in contexts or stale attendance',state()['contexts']==[]and state()['presence']==[])
clock='2026-10-25T10:00:00+05:30';check('old Sunday check-in does not carry into next week',state()['own']==[])
for day,name in [('2026-10-21','Healing Meeting'),('2026-10-23','Revival Meeting')]:
 clock=day+'T15:59:59+05:30';c=state()['contexts'][0];check('correct meeting '+day,c['category']==name);expect('before16 blocked '+name,attempt(c),member,'P0016')
 clock=day+'T16:00:00+05:30';check('at16 accepted '+name,key(c)in checkin(c)['state']['own'])
 clock=day+'T23:59:59+05:30';check('lastminute accepted '+name,key(c)in checkin(c,coord)['state']['own'])
clock='2026-10-21T10:00:00+05:30'
event=sql(f"insert into public.task_special_meetings(owner_id,start_date,duration_days)values('{owner}','2026-10-21',3)returning id;")
check('locked Special does not replace Healing',state()['contexts'][0]['category']=='Healing Meeting')
sql(f"update public.task_special_meetings set locked=false where id='{event}';")
c=state()['contexts'][0];check('activated Special replaces all regular check-in contexts',len(state()['contexts'])==1 and c['meetingId']==event)
expect('replaced Healing check-in denied',attempt({'categoryId':category,'meetingDate':'2026-10-18','service':'evening','meetingId':None}),member,'P0409')
for day in ['2026-10-21','2026-10-22','2026-10-23']:
 clock=day+'T06:59:59+05:30';c=state()['contexts'][0];expect('Special before7 blocked '+day,attempt(c),member,'P0016')
 clock=day+'T07:00:00+05:30';check('Special daily check-in '+day,key(c)in checkin(c)['state']['own'])
 clock=day+'T22:59:59+05:30';check('Special until23 accepted '+day,key(c)in checkin(c,coord)['state']['own'])
 clock=day+'T23:00:00+05:30';expect('Special23 exactly blocked '+day,attempt(c),member,'P0016')
clock='2026-10-24T00:00:00+05:30';check('expired Special attendance disappears',state()['contexts'][0]['category']=='Revival Meeting'and all(event not in p['key']for p in state()['presence']))
clock='2026-10-22T10:00:00+05:30';sql(f"update public.task_special_meetings set locked=true where id='{event}';");check('relock restores regular attendance contexts',state()['contexts'][0]['category']=='Healing Meeting')
expect('locked Special cannot check in',attempt(c),member,'P0409')
# Preserve all historic check-ins while excluding them from current scopes.
check('daily scopes remain separate saved records',sql(f"select count(*)from public.task_member_check_ins where meeting_id='{event}'and member_id='{mm}';")=='3')
single=sql(f"insert into public.task_special_meetings(owner_id,start_date,locked)values('{owner}','2026-10-27',false)returning id;")
clock='2026-10-27T10:00:00+05:30';single_context=state()['contexts'][0];check('blank-duration Special allows selected day',key(single_context)in checkin(single_context)['state']['own'])
clock='2026-10-28T10:00:00+05:30';check('blank-duration retention day does not invent next check-in day',state()['contexts'][0]['meetingDate']=='2026-10-27');expect('blank-duration next day is closed',attempt(single_context),member,'P0016')
check('verification has zero issues',sql((root/'supabase/verification/20261018_meeting_check_in_checks.sql').read_text())=='')
sql((root/'supabase/migrations/202610180041_meeting_check_in.sql').read_text(),fail='041 already installed');check('migration replay refused',True)
print('PASS all041 check-in checks',flush=True)
'''
program=source+'\n'+'\n'.join(' '+line if line else ''for line in cases.splitlines())+"\nfinally:\n subprocess.run(['docker','rm','-f',container],capture_output=True)\n"
exec(compile(program,str(root/'supabase/tests/workspace_assignments.py'),'exec'),{'__file__':str(root/'supabase/tests/workspace_assignments.py')})
