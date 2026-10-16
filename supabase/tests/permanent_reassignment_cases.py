rpc('task_app_setup',"'bootstrap',null",owner)
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Special Meeting';")
today=sql("select (statement_timestamp()at time zone 'Asia/Kolkata')::date;")
fields={'title':'Fictional reassignment','notes':'Keep details','status':'active','due_date':today,'due_time':'23:50','priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'daily','assigned_to_member_id':mm,'sunday_service':None}
def create(**patch):return rpc('task_app_create_tasks',literal([{**fields,**patch}]),owner)[0]
def fresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def series_version(t):return sql(f"select max(updated_at)from public.tasks where owner_id='{owner}'and series_id='{t['series_id']}'and deleted_at is null;")
def payload(t,**patch):return {**{key:t.get(key)for key in fields},**patch}
def status(t,value='completed',user=member):return rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','status',null,'{value}','this',null",user)
def reassign(t,user=coord,scope='this',permanent=True,version=None,expected=None,**patch):
 name='task_app_reassign_permanently'if permanent else'task_app_mutate'
 return f"select public.{name}('{t['id']}','{expected or t['updated_at']}','update',{literal(payload(t,**{'assigned_to_member_id':cm,**patch}))},null,'{scope}','{version or series_version(t)}');"
def save(t,**opts):return json.loads(sql(reassign(t,**opts),opts.get('user',coord)))
def fingerprint():return sql(f"select md5(jsonb_build_object('tasks',(select jsonb_agg(t order by id)from public.tasks t),'series',(select jsonb_agg(s order by id)from public.task_series s),'pending',(select jsonb_agg(p order by id)from public.task_repeat_pending p),'fines',(select jsonb_agg(f order by id)from public.task_fines f),'credits',(select jsonb_agg(c order by task_id)from public.member_task_completions c))::text);")
def release(t):
 pending=json.loads(sql(f"select to_jsonb(p)from public.task_repeat_pending p where series_id='{t['series_id']}'and not cancelled and generated_at is null;"))
 sql(f"select public.task_app_release_repeats('{owner}','{pending['due_date']}T00:00:00+05:30');")
 return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{pending['id']}';"))
# Build older unfinished, selected unfinished, completed future, active future,
# and a queued successor in the SAME series using the real repeat worker.
older=create();older=status(older);selected=release(older);selected=status(selected);completed=release(selected)
completed=status(completed);later=release(completed);later=status(later);pending_before=sql(f"select payload from public.task_repeat_pending where series_id='{later['series_id']}'and generated_at is null;")
later=status(later,'active');older=status(fresh(older),'active');selected=status(fresh(selected),'active')
sql(f"insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)values('{owner}','{older['id']}','Old fine','Special Meeting','{mm}','Sarah',statement_timestamp());")
history_before=sql(f"select md5(to_jsonb(t)::text)from public.tasks t where id='{completed['id']}';")
fines_before=sql("select md5(jsonb_agg(f order by id)::text)from public.task_fines f;")
credits_before=sql("select md5(jsonb_agg(c order by task_id)::text)from public.member_task_completions c;")
other=create(title='Other series')
for user,code in [(member,'P0403'),(outsider,None),(unverified,'P0403')]:
 before=fingerprint()
 if code:sql(reassign(selected),user,fail=code)
 else:check('cross-workspace task cannot be reassigned',sql(reassign(selected),user)=='')
 check('denied request preserves all task/schedule data',fingerprint()==before)
for patch in [dict(version='2000-01-01T00:00:00Z'),dict(expected='2000-01-01T00:00:00Z')]:
 before=fingerprint();check('stale task/series returns conflict',save(selected,**patch).get('conflict')is True);check('conflict writes nothing',fingerprint()==before)
# Missing/foreign/inactive assignee fails atomically, before or after delegation.
foreign=rpc('task_app_member_state','',outsider)['current']['id']
for bad in [foreign,users[15]]:
 before=fingerprint();sql(reassign(selected,assigned_to_member_id=bad),coord,fail='23514');check('invalid assignee rolls back all changes',fingerprint()==before)
sql(reassign(selected,status='completed'),coord,fail='P0403')
sql(reassign(fresh(completed)),coord,fail='P0409')
ordinary=create(repeat_rule='off');sql(reassign(ordinary,version=ordinary['updated_at']),coord,fail='23514')
sql(reassign(selected,repeat_rule='off'),coord,fail='23514')
# No direct client can use this RPC to complete/delete or bypass scope checks.
for query in [reassign(selected).replace("'update'", "'status'",1),reassign(selected).replace("'this'", "'all'",1),reassign(selected).replace("null,'this'", "'completed','this'",1)]:
 before=fingerprint();sql(query,coord,fail='23514');check('invalid operation/scope writes nothing',fingerprint()==before)
# Failure on a later occurrence must roll back the selected edit AND series.
sql(f"create function public.reassign_test_fail()returns trigger language plpgsql as $$begin if new.id='{later['id']}'and new.assigned_to_member_id='{cm}'then raise exception 'Intentional later-row failure';end if;return new;end;$$;create trigger reassign_test_fail before update on public.tasks for each row execute function public.reassign_test_fail();")
before=fingerprint();sql(reassign(selected),coord,fail='P0001');check('later-row failure rolls back entire reassignment',fingerprint()==before)
sql('drop trigger reassign_test_fail on public.tasks;drop function public.reassign_test_fail();')
saved=save(selected)
check('Coordinator permanently reassigns selected occurrence',saved['assigned_to_member_id']==cm and saved['notes']=='Keep details')
check('earlier unfinished occurrence retains its assignment',fresh(older)['assigned_to_member_id']==mm)
check('future active occurrence changes assignee only',fresh(later)['assigned_to_member_id']==cm and fresh(later)['due_date']==later['due_date'] and fresh(later)['notes']==later['notes'])
check('completed future record untouched byte-for-byte',history_before==sql(f"select md5(to_jsonb(t)::text)from public.tasks t where id='{completed['id']}';"))
check('other repeating series untouched',fresh(other)['assigned_to_member_id']==mm)
check('existing fines and completion credits untouched',fines_before==sql("select md5(jsonb_agg(f order by id)::text)from public.task_fines f;")and credits_before==sql("select md5(jsonb_agg(c order by task_id)::text)from public.member_task_completions c;"))
check('queued calendar payload stays unchanged',pending_before==sql(f"select payload from public.task_repeat_pending where series_id='{later['series_id']}'and generated_at is null;"))
next_task=release(later);check('queued successor inherits new permanent assignee',next_task['assigned_to_member_id']==cm)
# Reassignment alone leaves completion to the new assignee.
sql(f"select public.task_app_mutate('{saved['id']}','{saved['updated_at']}','status',null,'completed','this',null);",member,fail='P0403')
finished=status(saved,user=coord);check('new assignee completes with own attribution',finished['completed_by_member_id']==cm)
# Occurrence-only remains independent even if content scope is future.
once=create(title='One occurrence');once=save(once,permanent=False,scope='future')
check('one-occurrence assignment keeps original series owner',sql(f"select assigned_to_member_id from public.task_series where id='{once['series_id']}';")==mm)
check('one-occurrence unfinished task remains assigned to new member',fresh(once)['assigned_to_member_id']==cm)
once=status(once,user=coord);next_once=release(once);check('next repeat returns to original series assignee',next_once['assigned_to_member_id']==mm)
# Owner can change a repeating assignment with future content scope, too.
owner_task=create(title='Owner scope');owner_saved=save(owner_task,user=owner,scope='future',title='Updated future title')
check('Owner can combine future content and permanent assignment',owner_saved['title']=='Updated future title'and sql(f"select assigned_to_member_id from public.task_series where id='{owner_task['series_id']}';")==cm)
# Concurrent save waits for the same series lock and detects the changed version.
racing=create(title='Concurrent scope')
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended('{racing['series_id']}',0));update public.tasks set notes='Concurrent edit'where id='{racing['id']}';select pg_sleep(1.5);commit;")
 time.sleep(.2);action=pool.submit(sql,reassign(racing),coord)
 holder.result();result=json.loads(action.result())
check('concurrent edit yields conflict without replacing series assignee',result.get('conflict')is True and fresh(racing)['notes']=='Concurrent edit'and sql(f"select assigned_to_member_id from public.task_series where id='{racing['series_id']}';")==mm)
for role,want in [('anon','f'),('authenticated','t'),('service_role','f')]:
 check(role+' RPC grant is deliberate',sql(f"select has_function_privilege('{role}','public.task_app_reassign_permanently(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute');")==want)
sql(f"select public.task_app_legacy_mutate('{saved['id']}','{saved['updated_at']}','update',null,null,'future',null);",owner,fail='42501')
sql((root/'supabase/migrations/202610160032_permanent_reassignment.sql').read_text(),fail='Permanent reassignment is already installed')
print('PASS additive migration replay refused',flush=True)

checks=sql((root/'supabase/verification/20261016_permanent_reassignment_checks.sql').read_text()).splitlines()
check('all read-only deployment checks zero',len(checks)==4 and all(v.endswith('|0')for v in checks))
