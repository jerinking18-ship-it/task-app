"""Runs only inside the disposable offline workspace harness."""
old=sql("select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by id),''))from public.tasks t;")
sql((root/'supabase/migrations/202610150025_notifications.sql').read_text())
check('notification upgrade preserves existing tasks',sql("select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by id),''))from public.tasks t;")==old)
check('no historical notification backfill',len(rpc('task_app_notifications','',member)['entries'])==0)
for who in [owner,coord,member]:
 for table in ['task_notifications','task_reopen_requests','task_notification_preferences','task_notification_configuration']:expect('private inbox tables deny direct read',f'select * from public.{table};',who,'42501')
expect('private message creation cannot be called by a member',f"select public.task_app_emit_notification('{owner}','{mm}','fake','fine_applied');",member,'42501')
expect('unverified inbox read denied','select public.task_app_notifications();',unverified,'P0403')
check('other workspace has its own empty inbox',rpc('task_app_notifications','',outsider)['entries']==[])
rpc('task_app_setup',"'bootstrap',null",owner)
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Special Meeting';")
today=sql("select(clock_timestamp()at time zone 'Asia/Kolkata')::date;")
fields={'title':'Notification task','notes':'Fictional integration test','status':'active','due_date':today,'due_time':'23:50','priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
def create(**changes):return rpc('task_app_create_tasks',literal([{**fields,**changes}]),owner)[0]
def inbox(who):return rpc('task_app_notifications','',who)
def notices(who,kind=None):return [n for n in inbox(who)['entries']if kind is None or n['kind']==kind]
def status(t,who,value='active'):return rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','status',null,'{value}','this',null",who)
def current(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def request(t,who=member,reason='Work needs correction'):return rpc('task_app_request_reopening',f"'{t['id']}','{t['completed_at']}','{reason}',true",who)
def reqrow(r):return json.loads(sql(f"select to_jsonb(q)from public.task_reopen_requests q where id='{r['id']}';"))
def review(r,who=coord,decision='approved'):return rpc('task_app_review_reopening',f"'{r['id']}','{r['updated_at']}','{decision}',true",who)
t=create()
check('new task emits no excluded Task assigned message',not notices(member))
# Reassignment is distinct from initial creation and sends both affected parties.
changed=rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','update',{literal({**fields,'assigned_to_member_id':cm})},null,'this',null",owner)
check('reassignment notifies new and previous assignee only',len(notices(coord,'reassigned_to'))==1 and len(notices(member,'reassigned_from'))==1 and not notices(owner))
# Availability uses current absence/meeting rules and excludes absent helpers.
released=create(title='Released task')
a=sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)values('{owner}','{mm}','{category}','{today}',clock_timestamp(),clock_timestamp()+interval '2 days')returning id;")
check('release immediately persists availability for offline eligible recipients',sql(f"select count(*)from public.task_notifications where task_id='{released['id']}'and kind='task_available'and recipient_id in('{cm}','{ownmember}');")=='2')
avail=[n for n in notices(coord,'task_available')if n['taskId']==released['id']][0]
check('released occurrence notifies eligible teammate with Take action',avail['canTake']and avail['payload']['absenceId']==a)
check('original assignee does not get their own availability notice',not notices(member,'task_available'))
count_before=len(notices(coord,'task_available'));inbox(coord);check('availability catchup does not duplicate messages',len(notices(coord,'task_available'))==count_before)
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)values('{owner}','{ownmember}','{category}','{today}',clock_timestamp(),clock_timestamp()+interval '2 days');")
check('absent teammate cannot take released task',not any(n['canTake']for n in notices(owner,'task_available')))
taken=rpc('task_app_take_task',f"'{released['id']}','{released['updated_at']}','{a}',true",coord)
check('task taken sends original assignee one message',len([n for n in notices(member,'task_taken')if n['taskId']==released['id']])==1)
avail=[n for n in notices(coord,'task_available')if n['id']==avail['id']][0]
check('Taken state disables action and shows actual current helper',not avail['canTake']and avail['takenBy']=='Daniel')
completed=status(taken,coord,'completed')
check('released-task completion informs original assignee',len([n for n in notices(member,'released_completed')if n['taskId']==released['id']])==1)
offline_notice=next(n for n in notices(owner,'task_available')if n['taskId']==released['id'])
check('offline first read after claim retains Taken historical notice',not offline_notice['canTake']and offline_notice['takenBy']=='Daniel')
newreleased=create(title='New task during absence')
check('new work in existing absence emits only availability, no assignment notice',sql(f"select count(*)from public.task_notifications where task_id='{newreleased['id']}'and kind='task_available'and recipient_id='{cm}';")=='1')
sql(f"update public.account_member_absences set previous_expires_at=expires_at,expires_at=statement_timestamp(),cancelled_at=statement_timestamp()where id='{a}';")
check('unmarking absence disables stored Take actions',not any(n['canTake']for n in notices(coord,'task_available')if n['taskId']==newreleased['id']))
# End absences in this offline fixture; no production clock bypass is introduced.
sql("delete from public.task_coverage_claims;delete from public.account_member_absences;")
# Read acknowledgement is recipient-scoped, atomic and idempotent.
n=notices(member)[0]
expect('another member cannot mark this notice read',f"select public.task_app_read_notifications(array['{n['id']}']::uuid[]);",coord,'P0409')
read=rpc('task_app_read_notifications',f"array['{n['id']}']::uuid[]",member)
check('personal read acknowledgement records real time',read['marked'][0]['readAt']is not None)
read2=rpc('task_app_read_notifications',f"array['{n['id']}']::uuid[]",member)
check('read retries keep original seen timestamp',read==read2)
expect('duplicate read IDs rejected',f"select public.task_app_read_notifications(array['{n['id']}','{n['id']}']::uuid[]);",member,'P0409')
# Personal preferences never affect other users or disable mandatory kinds.
sql('select public.task_app_save_notification_preferences(false,false,false);',member)
check('only routine visibility preferences can change',inbox(member)['preferences']=={'availability':False,'coverageUpdates':False,'reassignments':False}and inbox(coord)['preferences']['availability'])
# Overdue catchup uses real due instant, not scheduled fine cutoff or task creation.
sql("update public.task_notification_configuration set started_at=clock_timestamp()-interval '2 days';")
due=sql("select to_char((clock_timestamp()-interval '2 minutes')at time zone 'Asia/Kolkata','YYYY-MM-DD|HH24:MI');").split('|')
overdue=create(title='Overdue notice',due_date=due[0],due_time=due[1]);first=[n for n in notices(member,'overdue')if n['taskId']==overdue['id']]
check('overdue emits once at actual past due instant',len(first)==1 and first[0]['payload']['dueAt']==first[0]['createdAt'])
inbox(member);check('overdue read catchup remains deduplicated',len([n for n in notices(member,'overdue')if n['taskId']==overdue['id']])==1)
# Missed completion generates fine and role-only completion notices separately.
sql('select public.task_app_enable_fines();')
missed=create(title='Missed sound task');missed=rpc('task_app_complete_missed',f"'{missed['id']}','{missed['updated_at']}',true",coord)
mnotice=[n for n in notices(member,'missed')if n['taskId']==missed['id']][0]
check('Missed and actual issued-fine messages are private to affected member',mnotice['canRequest']and mnotice['payload']['role']=='coordinator'and len([n for n in notices(member,'fine_applied')if n['taskId']==missed['id']])==1 and not notices(owner,'fine_applied'))
expect('uninvolved member cannot request someone else completion',f"select public.task_app_request_reopening('{missed['id']}','{missed['completed_at']}','Work needs correction',true);",owner,'P0403')
expect('request requires confirmation',f"select public.task_app_request_reopening('{missed['id']}','{missed['completed_at']}','Work needs correction',false);",member,'23514')
expect('request accepts structured reasons only',f"select public.task_app_request_reopening('{missed['id']}','{missed['completed_at']}','Free chat text',true);",member,'23514')
r=request(missed);r=reqrow(r)
check('request routed to exact actual completer only',r['reviewer_id']==cm and len(inbox(coord)['requests'])==1 and len(inbox(member)['requests'])==1 and not inbox(owner)['requests'])
check('duplicate request returns existing record without duplicate message',request(missed)['id']==r['id']and len(notices(coord,'request_received'))==1)
check('after requesting, personal Missed notification shows Pending and disables repeat submission',next(n for n in notices(member,'missed')if n['id']==mnotice['id'])['requestStatus']=='pending'and not next(n for n in notices(member,'missed')if n['id']==mnotice['id'])['canRequest'])
expect('another Owner cannot approve',f"select public.task_app_review_reopening('{r['id']}','{r['updated_at']}','approved',true);",owner,'P0403')
expect('requester cannot approve own request',f"select public.task_app_review_reopening('{r['id']}','{r['updated_at']}','approved',true);",member,'P0403')
fine_digest=sql("select md5(string_agg(to_jsonb(f)::text,'|'order by id))from public.task_fines f;")
review(r)
check('approval reopens task, clears Missed badge and preserves issued fine exactly',current(missed)['status']=='active'and current(missed)['missed_completion_role']is None and sql("select md5(string_agg(to_jsonb(f)::text,'|'order by id))from public.task_fines f;")==fine_digest)
check('approval records result and sends requester result message',reqrow(r)['status']=='approved'and notices(member,'request_result')[0]['payload']['status']=='approved')
expect('stale approval cannot run twice',f"select public.task_app_review_reopening('{r['id']}','{r['updated_at']}','approved',true);",coord,'P0409')
# Decline and deleted/moved/reopened completion update statuses without granting access.
for outcome in ['declined','deleted','bin','reopened']:
 task=create(title=outcome);task=rpc('task_app_complete_missed',f"'{task['id']}','{task['updated_at']}',true",coord);q=reqrow(request(task))
 if outcome=='declined':review(q,decision='declined');check('decline preserves completed task',current(task)['status']=='completed')
 elif outcome=='deleted':sql(f"delete from public.tasks where id='{task['id']}';")
 elif outcome=='bin':rpc('task_app_mutate',f"'{task['id']}','{task['updated_at']}','delete',null,null,'this',null",owner)
 else:status(task,coord)
 check('request status follows '+outcome,reqrow(q)['status']==('declined'if outcome=='declined'else'unavailable'))
 check('result stays visible to requester',any(n['payload'].get('requestId')==q['id']for n in notices(member,'request_result')))
# Fine settlement notices go to affected member; Members cannot manage fine page.
f=json.loads(sql(f"select to_jsonb(f)from public.task_fines f where task_id='{missed['id']}';"))
rpc('task_app_settle_fine',f"'{f['id']}','{f['updated_at']}','paid',null,true",owner)
check('paid fine generates one member notice',len(notices(member,'fine_paid'))==1)
expect('ordinary member still cannot open private fine management','select public.task_app_fines();',member,'P0403')
sql(f"update public.account_members set role='coordinator'where id='{mm}';")
check('promotion notice follows real role change',notices(member,'role_changed')[0]['payload']['role']=='coordinator')
sql(f"update public.account_members set role='member'where id='{mm}';")
check('demotion notice follows real role change',notices(member,'role_changed')[0]['payload']['role']=='member')
# Clear snapshot refuses new activity; physical deletion scoped to self only.
snapshot=rpc('task_app_notification_snapshot','',member)
sql(f"update public.account_members set role='coordinator'where id='{mm}';")
expect('stale clear snapshot refuses concurrent new notice',f"select public.task_app_clear_notifications({snapshot['count']},'{snapshot['snapshot']}',true);",member,'P0409')
snapshot=rpc('task_app_notification_snapshot','',member)
expect('clear requires explicit confirmation',f"select public.task_app_clear_notifications({snapshot['count']},'{snapshot['snapshot']}',false);",member,'23514')
other_count=len(notices(coord));task_digest=sql("select md5(string_agg(to_jsonb(t)::text,'|'order by id))from public.tasks t;");fine_digest=sql("select md5(string_agg(to_jsonb(f)::text,'|'order by id))from public.task_fines f;");request_count=len(inbox(member)['requests'])
result=rpc('task_app_clear_notifications',f"{snapshot['count']},'{snapshot['snapshot']}',true",member)
check('clear physically deletes all own message rows',result['deleted']==snapshot['count']and sql(f"select count(*)from public.task_notifications where recipient_id='{mm}';")=='0')
check('clearing preserves tasks fines requests other members messages',sql("select md5(string_agg(to_jsonb(t)::text,'|'order by id))from public.tasks t;")==task_digest and sql("select md5(string_agg(to_jsonb(f)::text,'|'order by id))from public.task_fines f;")==fine_digest and len(inbox(member)['requests'])==request_count and len(notices(coord))==other_count)
check('overdue catchup cannot resurrect permanently cleared messages',not notices(member))
sql(f"update public.account_members set role='member'where id='{mm}';")
check('fresh activity after clear still creates new messages',len(notices(member))==1 and notices(member)[0]['kind']=='role_changed')
check('no unsupported initial-assignment or repeat-ready kind exists',all(n['kind']not in ['assigned','task_assigned','repeat_ready']for n in notices(member)))
# Exact actor, visibility/read semantics and rollback under parallel mutations.
other=users[6];o=invite(7,'coordinator');om=rpc('task_app_accept_invitation',f"'{o['token']}','Other coordinator'",other)['current']['id']
task=create(title='Concurrent request');task=rpc('task_app_complete_missed',f"'{task['id']}','{task['updated_at']}',true",coord)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 results=list(pool.map(lambda _:request(task),range(2)))
check('concurrent duplicate requests serialize to one record',results[0]['id']==results[1]['id'])
q=reqrow(results[0]);expect('another Coordinator cannot approve exact actor request',f"select public.task_app_review_reopening('{q['id']}','{q['updated_at']}','approved',true);",other,'P0403')
rnotice=next(n for n in notices(coord,'request_received')if n['payload']['requestId']==q['id'])
rpc('task_app_read_notifications',f"array['{rnotice['id']}']::uuid[]",coord)
check('reading an incoming request never changes its decision',reqrow(q)['status']=='pending')
def decide(decision):
 try:return review(q,decision=decision)
 except AssertionError as e:return str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:results=list(pool.map(decide,['approved','declined']))
check('concurrent approve and decline commit exactly one decision',sum(isinstance(x,dict)for x in results)==1 and any('P0409'in str(x)for x in results))
check('concurrent decision leaves a consistent task state',current(task)['status']==('active'if reqrow(q)['status']=='approved'else'completed'))
# Force an offline-only failure inside the normal reopen mutation.
task=create(title='Atomic approval');task=rpc('task_app_complete_missed',f"'{task['id']}','{task['updated_at']}',true",coord);q=reqrow(request(task))
before=sql("select md5(string_agg(to_jsonb(t)::text,'|'order by id))from public.tasks t;")
sql("create function public.test_reopen_failure()returns trigger language plpgsql as $$begin if new.title='Atomic approval'and new.status='active'then raise exception 'fixture rollback'using errcode='P9999';end if;return new;end;$$;create trigger test_reopen_failure before update on public.tasks for each row execute function public.test_reopen_failure();")
expect('failed underlying reopen rolls back the decision',f"select public.task_app_review_reopening('{q['id']}','{q['updated_at']}','approved',true);",coord,'P9999')
check('failed approval keeps request pending and task untouched',reqrow(q)['status']=='pending'and sql("select md5(string_agg(to_jsonb(t)::text,'|'order by id))from public.tasks t;")==before)
sql('drop trigger test_reopen_failure on public.tasks;drop function public.test_reopen_failure();')
# A member leaving makes their pending request unavailable, never approvable.
sql(f"update public.account_members set left_at=clock_timestamp()where id='{mm}';")
expect('requester leaving prevents approval',f"select public.task_app_review_reopening('{q['id']}','{q['updated_at']}','approved',true);",coord,'P0409')
inbox(coord);check('requester leaving updates pending lifecycle',reqrow(q)['status']=='unavailable')
sql(f"update public.account_members set left_at=null,name='Renamed member'where id='{mm}';update public.account_members set name='Renamed coordinator'where id='{cm}';")
check('request and notification names resolve current profile',all(r['requesterName']=='Renamed member'and r['reviewerName']=='Renamed coordinator'for r in inbox(member)['requests'])and any(n['actorName']=='Renamed coordinator'for n in notices(member,'missed')))
# Retrying a stored request after its reviewer's clear never resurrects its notice.
snap=rpc('task_app_notification_snapshot','',coord)
rpc('task_app_clear_notifications',f"{snap['count']},'{snap['snapshot']}',true",coord)
request(task)
check('retrying an existing request cannot recreate a cleared request notice',not any(n['payload'].get('requestId')==q['id']for n in notices(coord,'request_received')))
# Message creation waits behind clearing, then survives as fresh activity.
snap=rpc('task_app_notification_snapshot','',member)
def clear_and_hold():return sql(f"begin;select public.task_app_clear_notifications({snap['count']},'{snap['snapshot']}',true);select pg_sleep(.8) /* notification-race-clear */;commit;",member)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 clearing=pool.submit(clear_and_hold)
 for _ in range(60):
  if sql("select count(*)from pg_stat_activity where wait_event='PgSleep'and query like '%notification-race-clear%';")!='0':break
  time.sleep(.01)
 sql(f"update public.account_members set role='coordinator'where id='{mm}';")
 clearing.result()
check('fresh message blocked behind clear survives after clearing commits',len(notices(member))==1 and notices(member)[0]['kind']=='role_changed')
# All four verification counters must be zero; never inspect private content.
check('read-only notification security verification passes',sql((root/'supabase/verification/20261015_notifications_checks.sql').read_text()).splitlines()==['0']*4)
print('All isolated notification integration checks passed.',flush=True)
