"""Executed inside the isolated workspace_assignments test harness only."""
# Never connects to hosted Supabase; IDs and privileged clock edits are fictional.
check('fine feature initially inactive',rpc('task_app_fines','',owner)['enabledAt']is None)
for who in [users[14],member,unverified]:expect('Member/departed/unverified fine read denied','select public.task_app_fines();',who,'P0403')
expect('private ledger table denied','select * from public.task_fines;',owner,'42501')
expect('client cannot assess another workspace',f"select public.task_app_assess_fines('{owner}',now());",owner,'42501')
expect('client cannot enable fines','select public.task_app_enable_fines();',owner,'42501')
for category,day in [('Sunday Service','2026-10-12'),('Healing Meeting','2026-10-15'),('Revival Meeting','2026-10-17')]:
 scheduled={'Sunday Service':'2026-10-11','Healing Meeting':'2026-10-14','Revival Meeting':'2026-10-16','Special Meeting':'2026-10-11'}[category]
 safe=category.replace("'","''")
 check('01:00 India cutoff '+category,sql(f"select public.task_app_fine_cutoff('{safe}','{scheduled}','23:50')=('{day}T01:00:00+05:30')::timestamptz;")=='t')
check('future custom due time never fined early',sql("select public.task_app_fine_cutoff('Sunday Service','2026-10-12','23:50')='2026-10-19T01:00:00+05:30'::timestamptz;")=='t')
check('Special Meeting has no new fine cutoff',sql("select public.task_app_fine_cutoff('Special Meeting','2026-10-11','23:50')is null;")=='t')
check('undated tasks have no guessed fine cutoff',sql("select public.task_app_fine_cutoff('Special Meeting',null,'23:50')is null;")=='t')
original_task_digest=sql("select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by id),''))from public.tasks t;")
activation=sql('select public.task_app_enable_fines();')
check('activation preserves tasks and is idempotent',sql("select md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by id),''))from public.tasks t;")==original_task_digest and sql('select public.task_app_enable_fines();')==activation)
sql("select public.task_app_assess_scheduled_fines();")
check('old cutoffs not backcharged at activation',sql('select count(*)from public.task_fines;')=='0')
# Use a future actual occurrence so the production trigger records it normally.
meeting_date=sql("select ((now()at time zone 'Asia/Kolkata')::date+8)::text;")
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Healing Meeting';")
member_active=joined[0]['current']['id']
seq=900
def create_fine_task(assignee=ownmember):
 global seq
 seq+=1;taskid=f'00000000-0000-4000-8000-{seq:012}'
 sql(f"insert into public.tasks(id,owner_id,title,status,due_date,due_time,priority,category_id,weekdays,assigned_to_member_id)values('{taskid}','{owner}','Fine test {seq}','active','{meeting_date}','23:50','medium','{category}','{{}}','{assignee}');")
 return taskid

def expire_candidate(taskid,completed=False,deleted=False):
 # Test-clock override only in this disposable database, never actual app code.
 sql(f"update public.task_fine_configuration set enabled_at=now()-interval '2 days';update public.task_fine_candidates set created_at=now()-interval '2 days',due_at=now()-interval '2 hours',cutoff_at=now()-interval '1 hour',completed={'true'if completed else'false'},deleted={'true'if deleted else'false'} where task_id='{taskid}';")

ids=[create_fine_task()for _ in range(3)]
for taskid in ids:expire_candidate(taskid)
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:list(pool.map(lambda _:sql('select public.task_app_assess_scheduled_fines();'),range(3)))
check('three tasks create three separate 50 rupee fines exactly once',sql(f"select count(*)||'|'||sum(amount_paise)from public.task_fines where task_id in({','.join(repr(x)for x in ids)});")=='3|15000')
check('other workspace reads no fines',rpc('task_app_fines','',outsider)['entries']==[])
record=next(f for f in rpc('task_app_fines','',owner)['entries']if f['taskId']==ids[0])
for who in [users[14],member,unverified]:expect('Member/departed/unverified cannot settle',f"select public.task_app_settle_fine('{record['id']}','{record['version']}','paid',null,true);",who,'P0403')
expect('other workspace cannot settle',f"select public.task_app_settle_fine('{record['id']}','{record['version']}','paid',null,true);",outsider,'P0409')
expect('cancel requires reason',f"select public.task_app_settle_fine('{record['id']}','{record['version']}','cancelled',' ',true);",owner,'23514')
expect('settlement requires confirmation',f"select public.task_app_settle_fine('{record['id']}','{record['version']}','paid',null,false);",owner,'23514')
result=rpc('task_app_settle_fine',f"'{record['id']}','{record['version']}','cancelled',' Equipment unavailable ',true",owner)
changed=next(f for f in result['data']['entries']if f['id']==record['id'])
check('Coordinator cancellation records reason author and real time',changed['status']=='cancelled'and changed['reason']=='Equipment unavailable'and changed['settledById']==ownmember and changed['settledAt']is not None)
expect('stale settled fine cannot be charged or changed again',f"select public.task_app_settle_fine('{record['id']}','{record['version']}','paid',null,true);",coord,'P0409')
record=next(f for f in rpc('task_app_fines','',coord)['entries']if f['taskId']==ids[1])
check('Owner can record payment',rpc('task_app_settle_fine',f"'{record['id']}','{record['version']}','paid',null,true",coord)['status']=='paid')
sql(f"update public.account_members set name='New fine member name'where id='{ownmember}';")
check('renamed fine member and cancellation author update together',next(f for f in rpc('task_app_fines','',coord)['entries']if f['taskId']==ids[0])['settledByName']=='New fine member name')
sql(f"delete from public.tasks where id='{ids[0]}';")
check('permanent task deletion preserves fine snapshot',sql(f"select count(*)from public.task_fines where task_id='{ids[0]}';")=='1')
# Actual deletion before cutoff marks candidate excluded for later assessment.
taskid=create_fine_task();sql(f"delete from public.tasks where id='{taskid}';");check('hard-delete trigger records exclusion before cutoff',sql(f"select deleted from public.task_fine_candidates where task_id='{taskid}';")=='t');expire_candidate(taskid,deleted=True);sql('select public.task_app_assess_scheduled_fines();')
check('task cancelled before cutoff not fined',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='0')
# Actual late completion must settle the old unfinished state first.
taskid=create_fine_task();expire_candidate(taskid);sql(f"update public.tasks set status='completed'where id='{taskid}';")
check('completion after cutoff keeps fine',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='1')
# On-time completion candidate remains completed until post-cutoff reopen.
taskid=create_fine_task();sql(f"update public.tasks set status='completed'where id='{taskid}';");expire_candidate(taskid,completed=True);sql(f"update public.tasks set status='active'where id='{taskid}';");sql('select public.task_app_assess_scheduled_fines();')
check('on-time completion reopened later receives no retroactive fine',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='0')
# Absent original member exemption, exact scheduled meeting date.
taskid=create_fine_task();expire_candidate(taskid)
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)values('{owner}','{ownmember}','{category}','{meeting_date}',now()-interval '2 hours',now()+interval '1 day');")
sql('select public.task_app_assess_scheduled_fines();')
check('absent original assignee with unclaimed task exempt',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='0')
# A different helper is not exempt just because the original member is absent.
taskid=create_fine_task(member_active);expire_candidate(taskid);sql('select public.task_app_assess_scheduled_fines();')
check('claimed helper assignment is responsible',sql(f"select member_id from public.task_fines where task_id='{taskid}';")==member_active)
# Late reassignment cannot move historical responsibility.
taskid=create_fine_task(member_active);expire_candidate(taskid);sql(f"update public.tasks set assigned_to_member_id='{ownmember}'where id='{taskid}';")
check('reassignment after cutoff does not transfer issued fine',sql(f"select member_id from public.task_fines where task_id='{taskid}';")==member_active)
# Outstanding debt has no year reset and no mutation to task completion credits.
sql(f"update public.task_fines set cutoff_at='2025-12-31T23:30:00Z'where task_id='{taskid}';")
check('prior-year unpaid fine remains visible',any(f['taskId']==taskid and f['status']=='unpaid'for f in rpc('task_app_fines','',coord)['entries']))
print('All isolated meeting fine checks passed.',flush=True)

# Exact instant, not browser local time, determines eligibility.
taskid=create_fine_task(member_active);boundary=sql(f"select cutoff_at from public.task_fine_candidates where task_id='{taskid}';")
sql(f"select public.task_app_finalize_fine('{taskid}','{boundary}'::timestamptz-interval '1 microsecond');")
check('one microsecond before cutoff produces no fine',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='0')
sql(f"select public.task_app_finalize_fine('{taskid}','{boundary}');")
check('exact cutoff assesses unfinished task once',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='1')
# Task in Bin is excluded; restoring before cutoff makes it eligible again.
taskid=create_fine_task(member_active);sql(f"update public.tasks set deleted_at=now()where id='{taskid}';")
check('Bin move tracks deletion flag',sql(f"select deleted from public.task_fine_candidates where task_id='{taskid}';")=='t')
sql(f"update public.tasks set deleted_at=null where id='{taskid}';")
check('restore before cutoff resumes ordinary eligibility',sql(f"select not deleted and not finalized from public.task_fine_candidates where task_id='{taskid}';")=='t')
expire_candidate(taskid);sql('select public.task_app_assess_scheduled_fines();')
check('restored unfinished task receives one fine',sql(f"select count(*)from public.task_fines where task_id='{taskid}';")=='1')

# Rescheduling an excluded old occurrence to a new future cutoff becomes eligible,
# but an already-assessed occurrence never receives a second charge.
taskid=create_fine_task(member_active);expire_candidate(taskid,completed=True);sql('select public.task_app_assess_scheduled_fines();')
sql(f"update public.tasks set due_date=due_date+7 where id='{taskid}';")
check('explicit future reschedule of uncharged old task creates a new pending deadline',sql(f"select not finalized and cutoff_at>now()from public.task_fine_candidates where task_id='{taskid}';")=='t')
charged=ids[2];sql(f"update public.tasks set due_date=due_date+14 where id='{charged}';")
check('rescheduling charged occurrence never duplicates fine',sql(f"select finalized from public.task_fine_candidates where task_id='{charged}';")=='t'and sql(f"select count(*)from public.task_fines where task_id='{charged}';")=='1')
# Stale financial permission is rechecked at each RPC.
rpc('task_app_change_role',f"'{ownmember}','coordinator','member',true",coord)
expect('demoted Coordinator immediately denied fine read','select public.task_app_fines();',owner,'P0403')
rpc('task_app_change_role',f"'{ownmember}','member','coordinator',true",coord)
expect('manager cannot directly change ledger amount',f"update public.task_fines set amount_paise=1 where task_id='{charged}';",owner,'42501')
# Validate the installer contract using a local cron-schema stub. This tests SQL
# installation/idempotency guards, not the external scheduler's runtime delivery.
sql("create schema cron;create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);create function cron.schedule(text,text,text)returns bigint language sql as $$insert into cron.job(jobname,schedule,command)values($1,$2,$3)returning jobid$$;")
activation_before=sql('select enabled_at from public.task_fine_configuration;')
installer=(root/'supabase/verification/20261014_meeting_fines_cron_install.sql').read_text()
sql(installer);sql(installer)
check('cron installer is idempotent and does not reset activation',sql("select count(*)from cron.job where jobname='task-app-meeting-fines'and schedule='* * * * *'and command='select public.task_app_assess_scheduled_fines();'and active;")=='1'and sql('select enabled_at from public.task_fine_configuration;')==activation_before)
sql("update cron.job set schedule='0 0 * * *';")
expect('cron installer refuses to silently replace an unexpected job',installer,None,'P0001')
check('unexpected job preserved after installer rollback',sql('select schedule from cron.job;')=='0 0 * * *')
checks=sql((root/'supabase/verification/20261014_meeting_fines_checks.sql').read_text())
check('fine schema verification has no access or ledger invariant failures',all(line.split('|')[1]=='0'for line in checks.splitlines()))
