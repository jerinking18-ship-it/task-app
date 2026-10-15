"""Only runs within credential-free disposable Postgres harness."""
# Upgrade over existing data: add metadata only, preserve records and old ACLs.
def preserved():return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(to_jsonb(t)-'missed_completion_role'order by id)from public.tasks t),'accounts',(select jsonb_agg(to_jsonb(u)order by id)from auth.users u),'members',(select jsonb_agg(to_jsonb(m)order by id)from public.account_members m),'fineconfig',(select jsonb_agg(c)from public.task_fine_configuration c))::text);")
digest=preserved()
acl=sql("select md5(string_agg(oid::text||coalesce(proacl::text,'')||proowner::text,'|'order by oid))from pg_proc where oid in('public.task_app_set_completion_member()'::regprocedure,'public.task_app_count_member_completion()'::regprocedure,'public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure);")
sql((root/'supabase/migrations/202610150024_missed_completion.sql').read_text())
check('migration preserves existing tasks accounts members and activation',preserved()==digest)
check('existing function owners and access unchanged',sql("select md5(string_agg(oid::text||coalesce(proacl::text,'')||proowner::text,'|'order by oid))from pg_proc where oid in('public.task_app_set_completion_member()'::regprocedure,'public.task_app_count_member_completion()'::regprocedure,'public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)'::regprocedure);")==acl)
rpc('task_app_setup',"'bootstrap',null",owner)
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Special Meeting';")
today=sql("select (clock_timestamp()at time zone 'Asia/Kolkata')::date;")
fields={'title':'Prepare sound','notes':'Fictional missed test','status':'active','due_date':today,'due_time':'23:50','priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
def create(**changes):return rpc('task_app_create_tasks',literal([{**fields,**changes}]),owner)[0]
def missed(t,who=coord,confirmed=True):return rpc('task_app_complete_missed',f"'{t['id']}','{t['updated_at']}',{str(confirmed).lower()}",who)
def denied(t,who,code='P0403',confirmed=True):expect('Missed completion rejects unauthorized/conflicting request',f"select public.task_app_complete_missed('{t['id']}','{t['updated_at']}',{str(confirmed).lower()});",who,code)
def status(t,who,new='active',fail=None):
 query=f"select public.task_app_mutate('{t['id']}','{t['updated_at']}','status',null,'{new}','this',null);"
 if fail:return expect('ordinary status respects recorded actor',query,who,fail)
 return json.loads(sql(query,who))
def current(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def fine(t):return json.loads(sql(f"select coalesce(jsonb_agg(f),'[]')from public.task_fines f where task_id='{t['id']}';"))
def count_credit(mid):return int(sql(f"select coalesce(sum(completed_count),0)from public.member_completion_totals where member_id='{mid}';"))
check('private RPC and legacy helper ACLs remain closed',sql("select not has_function_privilege('anon','public.task_app_complete_missed(uuid,timestamptz,boolean)','execute')and not has_function_privilege('service_role','public.task_app_complete_missed(uuid,timestamptz,boolean)','execute')and not has_function_privilege('authenticated','public.task_app_legacy_before_coverage_mutate(uuid,timestamptz,text,jsonb,text,text,timestamptz)','execute');")=='t')
t=create()
denied(t,coord,'23514',False)
denied(t,member);denied(t,unverified);denied(t,outsider,'P0409')
denied(t,owner,'P0409')
check('inactive fine feature blocks completion atomically',current(t)['status']=='active'and not fine(t))
sql('select public.task_app_enable_fines();')
activation=sql('select enabled_at from public.task_fine_configuration;')
# One extra verified coordinator to prove actor identity, rather than role equality.
inv=rpc('task_app_invite',"'person7@example.test','coordinator',null",owner)
other=rpc('task_app_accept_invitation',f"'{inv['token']}','Other coordinator'",users[6])['current']['id']
coordinator_credit=count_credit(cm)
done=missed(t)
check('Coordinator completes while preserving assignee',done['status']=='completed'and done['assigned_to_member_id']==mm and done['completed_by_member_id']==cm and done['missed_completion_role']=='coordinator'and done['completed_at']is not None)
check('immediate fine charges original current assignee once before future cutoff',len(fine(t))==1 and fine(t)[0]['member_id']==mm and fine(t)[0]['amount_paise']==5000 and sql(f"select cutoff_at>clock_timestamp()from public.task_fine_candidates where task_id='{t['id']}';")=='t')
check('actual completer receives annual credit',count_credit(cm)==coordinator_credit+1)
for who in [member,owner,users[6]]:status(done,who,fail='P0403')
denied(t,coord,'P0409')
check('stale confirmation retry cannot duplicate charge',len(fine(t))==1)
# Direct edit cannot bypass the actor-only reopen gate.
reopenfields={**fields,'status':'active'}
for who in [owner,users[6]]:
 expect('update route cannot bypass actor-only reopen',f"select public.task_app_mutate('{done['id']}','{done['updated_at']}','update',{literal(reopenfields)},null,'this',null);",who,'P0403')
active=status(done,coord)
check('actor reopens and removes badge/credit but keeps fine',active['status']=='active'and active['missed_completion_role']is None and active['completed_by_member_id']is None and count_credit(cm)==coordinator_credit and len(fine(t))==1)
# Ordinary assignee completion after reopening uses ordinary attribution/permissions.
member_credit=count_credit(mm)
normal=status(active,member,'completed')
check('original assignee may complete normally after reopen',normal['missed_completion_role']is None and normal['completed_by_member_id']==mm and count_credit(mm)==member_credit+1 and count_credit(cm)==coordinator_credit)
active=status(normal,member)
done2=missed(active,users[6])
check('different coordinator may confirm fresh Missed completion without second fine',done2['completed_by_member_id']==other and len(fine(t))==1 and count_credit(mm)==member_credit and count_credit(other)==1)
status(done2,coord,fail='P0403');status(done2,owner,fail='P0403');status(done2,member,fail='P0403')
# Cancelled financial ledger entries must remain cancelled on repeat completion.
f=fine(t)[0]
rpc('task_app_settle_fine',f"'{f['id']}','{f['updated_at']}','cancelled','Approved cancellation',true",owner)
active=status(done2,users[6]);done2=missed(active)
check('cancelled fine is never reissued or overwritten',len(fine(t))==1 and fine(t)[0]['status']=='cancelled')
# Reopen belongs to person even if they are demoted later.
sql(f"update public.account_members set role='member'where id='{cm}';")
active=status(done2,coord)
check('recorded actor can still reopen after demotion',active['status']=='active')
denied(active,coord)
sql(f"update public.account_members set role='coordinator'where id='{cm}';")
# Manager own work follows normal completion; no fine exception there.
own=create(assigned_to_member_id=cm);denied(own,coord)
normal=status(own,coord,'completed')
check('own normal completion has no Missed badge or immediate fine',normal['missed_completion_role']is None and not fine(own))
# Owner exception and current member completing their ordinary work remain distinct.
owned=create();owned=missed(owned,owner)
check('Owner attribution is role snapshot with real actor ID',owned['missed_completion_role']=='owner'and owned['completed_by_member_id']==ownmember)
status(owned,coord,fail='P0403');status(owned,member,fail='P0403')
status(owned,owner)
# Active absence uses Take task, never creates a punitive Missed fine.
absent=create()
sql(f"insert into public.account_member_absences(owner_id,member_id,category_id,meeting_date,created_at,expires_at)values('{owner}','{mm}','{category}','{today}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');")
denied(absent,coord,'P0409')
check('active absence rejection preserves task and excludes immediate fine',current(absent)['status']=='active'and not fine(absent))
sql(f"delete from public.account_member_absences where member_id='{mm}'and category_id='{category}';")
# Bin and unreleased future occurrences cannot be charged by this action.
binned=create();sql(f"update public.tasks set deleted_at=clock_timestamp()where id='{binned['id']}';");denied(binned,coord,'P0409');check('Bin task not fined',not fine(binned))
future=create();sql(f"update public.tasks set available_at=clock_timestamp()+interval '1 day'where id='{future['id']}';");denied(current(future),coord,'P0409');check('unreleased task not fined',not fine(future))
# Existing automatic cutoff already issued a fine; confirmation preserves it.
late=create();sql(f"update public.task_fine_candidates set cutoff_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days',due_at=clock_timestamp()-interval '1 hour'where task_id='{late['id']}';update public.task_fine_configuration set enabled_at=clock_timestamp()-interval '3 days';")
sql('select public.task_app_assess_scheduled_fines();');beforefine=fine(late);missed(late)
check('pre-existing automatic fine remains identical',len(beforefine)==1 and fine(late)==beforefine)
# Contention: two manager confirmations converge; exactly one may complete.
race=create()
def racer(who):
 try:return missed(race,who)
 except AssertionError as e:return str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:results=list(pool.map(racer,[coord,users[6]]))
check('concurrent confirmations commit one actor and one fine',sum(isinstance(r,dict)for r in results)==1 and len(fine(race))==1)
# A failed task update must also rollback the newly inserted financial record.
rollback=create()
sql(f"create function public.missed_test_fail()returns trigger language plpgsql as $$begin if new.id='{rollback['id']}'then raise exception 'fixture failure';end if;return new;end;$$;create trigger zz_missed_test_fail before update on public.tasks for each row execute function public.missed_test_fail();")
denied(rollback,coord,'P0001')
check('task/fine/credit atomic rollback',current(rollback)['status']=='active'and not fine(rollback))
sql('drop trigger zz_missed_test_fail on public.tasks;drop function public.missed_test_fail();')
# Repeat occurrence only: same existing queue; no immediate next task or second queue.
repeat=create(repeat_rule='daily');series=repeat['series_id'];repeat=missed(repeat)
check('Missed repeat completion queues one future occurrence',sql(f"select count(*)from public.task_repeat_pending where series_id='{series}'and not cancelled;")=='1'and sql(f"select count(*)from public.tasks where series_id='{series}';")=='1')
active=status(repeat,coord);repeat=missed(active)
check('Missed recompletion never duplicates pending repeat',sql(f"select count(*)from public.task_repeat_pending where series_id='{series}'and not cancelled;")=='1'and len(fine(repeat))==1)
check('future series assignment remains unchanged',sql(f"select assigned_to_member_id from public.task_series where id='{series}';")==mm)
# Permanent deletion retains ledger/established yearly total.
before=count_credit(cm);sql(f"delete from public.tasks where id='{repeat['id']}';")
check('permanent deletion retains fine and yearly credit',count_credit(cm)==before and len(fine(repeat))==1)
print('All isolated Missed completion checks passed.',flush=True)

checks=sql((root/'supabase/verification/20261015_missed_completion_checks.sql').read_text())
check('all four read-only Missed postchecks have zero violations',len(checks.splitlines())==4 and all(line.split('|')[1]=='0'for line in checks.splitlines()))
