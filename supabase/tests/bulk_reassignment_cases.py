baseline_functions=json.loads(sql("select jsonb_agg(jsonb_build_object('oid',oid,'body',prosrc,'owner',proowner,'acl',proacl)order by oid)from pg_proc where pronamespace='public'::regnamespace;"))
baseline_rows=sql("select md5(coalesce(jsonb_agg(t order by id)::text,'[]'))from public.tasks t;")
baseline_security=sql("select md5(jsonb_agg(jsonb_build_array(oid,relacl,relrowsecurity,relforcerowsecurity)order by oid)::text)from pg_class where relnamespace='public'::regnamespace and relkind='r';")
sql((root/'supabase/migrations/202610180039_bulk_reassignment.sql').read_text())
old_oids=','.join(str(x['oid'])for x in baseline_functions)
check('039 preserves existing function definitions ownership and ACLs',baseline_functions==json.loads(sql(f"select jsonb_agg(jsonb_build_object('oid',oid,'body',prosrc,'owner',proowner,'acl',proacl)order by oid)from pg_proc where oid in({old_oids});")))
check('039 preserves existing rows and table security',baseline_rows==sql("select md5(coalesce(jsonb_agg(t order by id)::text,'[]'))from public.tasks t;")and baseline_security==sql("select md5(jsonb_agg(jsonb_build_array(oid,relacl,relrowsecurity,relforcerowsecurity)order by oid)::text)from pg_class where relnamespace='public'::regnamespace and relkind='r';"))
# This clock belongs only to this disposable DB; production keeps fresh clocks.
import ast
clock_ast=ast.parse((root/'supabase/tests/current_schema_regressions.py').read_text())
clock_code=next(ast.literal_eval(n.value)for n in clock_ast.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='clock_setup'for t in n.targets))
exec(clock_code)
rpc('task_app_setup',"'bootstrap',null",owner)
category_ids={name:sql(f"select id from public.categories where owner_id='{owner}'and name='{name}';")for name in ['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting']}
base={'title':'Prepare sound','notes':'Keep these details','status':'active','due_date':'2026-12-23','due_time':'23:50','priority':'medium','category_id':category_ids['Healing Meeting'],'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':None}
def create(**patch):return rpc('task_app_create_tasks',literal([{**base,**patch}]),owner)[0]
def fresh(t):return json.loads(sql(f"select to_jsonb(t)from public.tasks t where id='{t['id']}';"))
def fields(t,**patch):return {**json.loads(sql(f"select public.task_app_reassignment_fields(t)from public.tasks t where id='{t['id']}';")),**patch}
def preview(t,user=coord):return rpc('task_app_reassignment_preview',f"'{t['id']}','{t['updated_at']}'",user)
def query(t,s,permanent=False,target=cm,**patch):return f"select public.task_app_reassign_all('{t['id']}','{t['updated_at']}','{target}','{s['token']}',{'true'if permanent else'false'},{literal(fields(t,assigned_to_member_id=target,**patch))});"
def save(t,s=None,**opts):return json.loads(sql(query(t,s or preview(t),**opts),coord))
def fingerprint():return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(t order by id)from public.tasks t),'series',(select jsonb_agg(s order by id)from public.task_series s),'plans',(select jsonb_agg(p order by id)from public.task_special_plans p),'fines',(select jsonb_agg(f order by id)from public.task_fines f),'credits',(select jsonb_agg(c order by task_id)from public.member_task_completions c))::text);")
def change(t,status,user=member):return rpc('task_app_mutate',f"'{t['id']}','{t['updated_at']}','status',null,'{status}'",user)
selected=create();other=create(title='Arrange chairs',category_id=category_ids['Revival Meeting'],due_date='2026-12-25')
repeat=create(title='Repeating sound',repeat_rule='daily');special=create(title='Special sound',category_id=category_ids['Special Meeting'],special_days=3,repeat_rule='daily')
binned=create(title='In Bin');rpc('task_app_mutate',f"'{binned['id']}','{binned['updated_at']}','delete'",owner)
completed=create(title='Already completed');completed=change(completed,'completed')
untouched=create(title='Different assignee',assigned_to_member_id=ownmember)
rpc('task_app_mark_absent',f"'{category_ids['Healing Meeting']}',null,true",member)
sql(f"insert into public.task_fines(owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)values('{owner}','{selected['id']}','Existing fine','Healing Meeting','{mm}','Sarah','2026-12-24T01:00:00+05:30');")
source=preview(selected);check('preview counts unfinished tasks across categories including locked preparations',source['count']==4 and source['repeatCount']==2 and source['sourceId']==mm)
for user in [member,unverified]:
 sql(f"select public.task_app_reassignment_preview('{selected['id']}','{selected['updated_at']}');",user,fail='P0403')
 sql(query(selected,source),user,fail='P0403')
check('Member and unverified identity cannot preview or reassign',True)
sql(f"select public.task_app_reassignment_preview('{selected['id']}','{selected['updated_at']}');",outsider,fail='P0039')
check('foreign workspace cannot inspect another task',True)
foreign=rpc('task_app_member_state','',outsider)['current']['id']
for target in [foreign,users[15],mm]:
 before=fingerprint();sql(query(selected,source,target=target),coord,fail='23514');check('invalid or unchanged target changes nothing',fingerprint()==before)
stale={**source,'token':'0'*32};before=fingerprint();sql(query(selected,stale),coord,fail='P0039');check('stale snapshot rolls back all tasks',fingerprint()==before)
new=create(title='Added during confirmation');before=fingerprint();sql(query(selected,source),coord,fail='P0039');check('newly added task requires count review',fingerprint()==before)
source=preview(selected);sql(f"update public.tasks set notes='Changed elsewhere'where id='{other['id']}';")
before=fingerprint();sql(query(selected,source),coord,fail='P0039');check('another task edit requires snapshot review',fingerprint()==before)
source=preview(selected)
for patch in [{'status':'completed'},{'due_date':'2026-12-24'},{'repeat_rule':'daily'}]:
 before=fingerprint();sql(query(selected,source,**patch),coord,fail='23514');check('bulk cannot complete tasks or hide schedule changes',fingerprint()==before)
# Inject a later-row failure; no selected/earlier-row assignment may survive.
sql(f"create function public.bulk_test_fail()returns trigger language plpgsql as $$begin if new.id='{special['id']}'and new.assigned_to_member_id='{cm}'then raise exception 'Injected failure';end if;return new;end;$$;create trigger bulk_test_fail before update on public.tasks for each row execute function public.bulk_test_fail();")
before=fingerprint();sql(query(selected,source),coord,fail='P0001');check('one failed row rolls back the whole selection',fingerprint()==before)
sql('drop trigger bulk_test_fail on public.tasks;drop function public.bulk_test_fail();')
preserved=sql(f"select md5(jsonb_agg(t order by id)::text)from public.tasks t where id in('{binned['id']}','{completed['id']}','{untouched['id']}');")
result=save(selected,source,notes='Edited selected note');check('bulk occurrence-only returns exact affected count',result['count']==5)
check('all selected unfinished tasks move atomically',sql(f"select count(*)from public.tasks where id in('{selected['id']}','{other['id']}','{repeat['id']}','{special['id']}','{new['id']}')and assigned_to_member_id='{cm}';")=='5')
check('reassigned absent work is no longer available for teammates to take',not any(r['task_id']==selected['id']for r in rpc('task_app_available_coverage','',coord)))
check('other task metadata stays unchanged',fresh(other)['notes']=='Changed elsewhere'and fresh(selected)['notes']=='Edited selected note')
check('completed Bin and other member tasks remain byte-identical',preserved==sql(f"select md5(jsonb_agg(t order by id)::text)from public.tasks t where id in('{binned['id']}','{completed['id']}','{untouched['id']}');"))
check('occurrence-only keeps both ordinary and Special future assignees',sql(f"select assigned_to_member_id from public.task_series where id='{repeat['series_id']}';")==mm and sql(f"select payload->>'assigned_to_member_id'from public.task_special_plans where id='{special['special_plan_id']}';")==mm)
sql(query(selected,source),coord,fail='P0039');check('replaying a confirmed reassignment cannot apply again',True)
# A fresh selection demonstrates permanent updates and preserves stopped/locked flags.
p1=create(title='Permanent ordinary',repeat_rule='daily');p2=create(title='Permanent Special',category_id=category_ids['Special Meeting'],special_days=3,repeat_rule='daily');p3=create(title='Permanent ordinary nonrepeat')
sp=preview(p1);fines_before=sql('select md5(coalesce(jsonb_agg(f order by id)::text,\'[]\'))from public.task_fines f;')
result=save(p1,sp,permanent=True);check('permanent selection includes repeating and nonrepeating tasks',result['count']==3)
check('permanent updates ordinary future series assignee',sql(f"select assigned_to_member_id from public.task_series where id='{p1['series_id']}';")==cm)
check('permanent updates Special daily plan without unlocking it',sql(f"select payload->>'assigned_to_member_id'from public.task_special_plans where id='{p2['special_plan_id']}';")==cm and sql(f"select locked from public.task_special_meetings where id=(select meeting_id from public.task_special_plans where id='{p2['special_plan_id']}');")=='t')
check('reassignment does not create or change fines',fines_before==sql('select md5(coalesce(jsonb_agg(f order by id)::text,\'[]\'))from public.task_fines f;'))
# Real repeat release inherits series assignee; no duplicate task rows are created.
p1=change(fresh(p1),'completed',coord)
pending=json.loads(sql(f"select to_jsonb(p)from public.task_repeat_pending p where series_id='{p1['series_id']}'and generated_at is null and not cancelled;"))
sql(f"select public.task_app_release_repeats('{owner}','{pending['due_date']}T00:00:00+05:30');")
check('queued repeat inherits the permanent assignee',sql(f"select assigned_to_member_id from public.tasks where id='{pending['id']}';")==cm)
# Daily Special release obeys both assignment durations without duplicate rows.
state=rpc('task_app_special_state','',owner)
plan=next(p for p in state['plans']if p['id']==p2['special_plan_id'])
event=next(e for e in state['meetings']if e['id']==plan['meetingId'])
rpc('task_app_set_special_locked',f"'{event['id']}','{event['version']}',false,true",coord)
sql(f"select public.task_app_release_special('{owner}','2026-12-24T00:00:00+05:30');")
check('next Special day inherits permanent new assignee',sql(f"select assigned_to_member_id from public.tasks where special_plan_id='{p2['special_plan_id']}'and due_date='2026-12-24';")==cm)
check('occurrence-only Special next day keeps its original assignee',sql(f"select assigned_to_member_id from public.tasks where special_plan_id='{special['special_plan_id']}'and due_date='2026-12-24';")==mm)
# Contending edit uses the same series lock, then forces a fresh count review.
racing=create(title='Concurrent regular',repeat_rule='daily');snap=preview(racing)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 holder=pool.submit(sql,f"begin;select pg_advisory_xact_lock(hashtextextended('{racing['series_id']}',0));update public.tasks set notes='Concurrent edit'where id='{racing['id']}';select pg_sleep(1);commit;")
 time.sleep(.2);action=pool.submit(sql,query(racing,snap),coord,'P0039');holder.result();action.result()
check('concurrent edit never silently overwrites a bulk selection',fresh(racing)['assigned_to_member_id']==mm and fresh(racing)['notes']=='Concurrent edit')
owner_snapshot=preview(fresh(racing),owner)
owner_result=json.loads(sql(query(fresh(racing),owner_snapshot,target=ownmember),owner))
check('Owner can confirm the same manager-only bulk action',owner_result['count']==owner_snapshot['count']and fresh(racing)['assigned_to_member_id']==ownmember)
check('read-only039 deployment checks report zero issues',sql((root/'supabase/verification/20261018_bulk_reassignment_checks.sql').read_text())=='')
for name in ['task_app_reassignment_state(uuid,uuid)','task_app_reassignment_fields(public.tasks)']:
 check('private helper denied to all clients',sql(f"select bool_and(not has_function_privilege(r,'public.{name}','execute'))from unnest(array['anon','authenticated','service_role'])r;")=='t')
for name in ['task_app_reassignment_preview(uuid,timestamptz)','task_app_reassign_all(uuid,timestamptz,uuid,text,boolean,jsonb)']:
 check('public RPC authenticated only with internal manager gate',sql(f"select has_function_privilege('authenticated','public.{name}','execute')and not has_function_privilege('anon','public.{name}','execute')and not has_function_privilege('service_role','public.{name}','execute');")=='t')
sql((root/'supabase/migrations/202610180039_bulk_reassignment.sql').read_text(),fail='039 already installed')
print('PASS all bulk reassignment checks',flush=True)
