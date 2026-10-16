def activity(user=owner,member_filter=None,relation='performed',meeting=None,kind=None,before=None,before_id=None):
 args=','.join('null'if x is None else "'"+str(x).replace("'","''")+"'"for x in [member_filter,relation,meeting,kind,None,before,before_id])
 return rpc('task_app_activity',args,user)
check('Owner and Coordinator can read activity',isinstance(activity()['entries'],list)and isinstance(activity(coord)['entries'],list))
expect('Member cannot read activity','select public.task_app_activity();',member,'P0403')
expect('Outsider cannot filter another workspace member',f"select public.task_app_activity('{mm}');",outsider,'P0403')
expect('Anonymous cannot read activity','set role anon;select public.task_app_activity();',None,'42501')
expect('Authenticated direct writes denied',"insert into public.task_activity_log(owner_id,kind)values('"+owner+"','role_changed');",owner,'42501')
expect('Authenticated direct reads denied','select * from public.task_activity_log;',owner,'42501')
expect('Private audit emitter cannot be called',f"select public.task_app_record_activity('{owner}','forged',null,null,null,'{{}}','{{}}');",owner,'42501')
expect('Invalid direction rejected',"select public.task_app_activity(null,'all');",owner,'23514')
expect('Incomplete cursor rejected',"select public.task_app_activity(null,'performed',null,null,null,now(),null);",owner,'23514')
category='00000000-0000-4000-8000-000000008001';task='00000000-0000-4000-8000-000000008002'
sql(f"insert into public.categories(id,owner_id,name)values('{category}','{owner}','Revival Meeting');")
def actor_sql(q,u=owner):return sql(q,u)
# Validated RPC ensures real actor attribution and status authorization.
fields={'title':'Activity task','notes':'Private notes must never enter the log','status':'active','priority':'medium','category_id':category,'due_date':None,'due_time':None,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm}
created=rpc('task_app_create_tasks',literal([fields]),owner)[0]
task=created['id']
check('Task create records real actor and assignee',any(e['kind']=='task_created'and e['actorId']==ownmember and mm in e['affectedIds']for e in activity()['entries']))
check('No task notes, emails or tokens copied into activity','Private notes'not in json.dumps(activity())and 'example.test'not in json.dumps(activity()))
# use server function signature from current schema to exercise completion.
version=sql(f"select updated_at from public.tasks where id='{task}';")
rpc('task_app_mutate',f"'{task}','{version}','status',null,'completed','this',null",member)
check('Assignee completion appears in performed',any(e['kind']=='task_completed'for e in activity(owner,mm)['entries']))
check('Self completion is excluded from affecting',not any(e['kind']=='task_completed'for e in activity(owner,mm,'affecting')['entries']))
# Permanent deletion has no cascading FK back to the log.
sql(f"delete from public.tasks where id='{task}';")
check('Completion survives permanent task deletion',any(e['kind']=='task_completed'and e['title']=='Activity task'for e in activity()['entries']))
check('System cleanup records no forged member actor',any(e['kind']=='task_deleted'and e['actorId']is None and e['actorName']=='System'for e in activity()['entries']))
rpc('task_app_change_role',f"'{mm}','member','coordinator',true",owner)
check('Role change affects member',any(e['kind']=='role_changed'for e in activity(owner,mm,'affecting')['entries']))
rpc('task_app_change_role',f"'{mm}','coordinator','member',true",owner)
# Presence and last-seen heartbeats must not fill the log.
before=sql('select count(*)from public.task_activity_log;')
sql(f"update public.account_members set last_seen_at=clock_timestamp()where id='{mm}';")
check('Presence-only changes do not produce audit activity',before==sql('select count(*)from public.task_activity_log;'))
# Profiles are resolved to current names; same text labels do not merge identities.
sql(f"update public.account_members set name='Sarah New'where id='{mm}';")
check('Current names update completed attribution',any(e['kind']=='task_completed'and e['actorName']=='Sarah New'for e in activity()['entries']))
check('Workspace isolation',not any(e['title']=='Activity task'for e in activity(outsider)['entries']))
check('Meeting/action filters match',all(e['kind']=='task_completed'and e['category']=='Revival Meeting'for e in activity(owner,None,'performed','Revival Meeting','task_completed')['entries']))
# Trigger projection fixtures run only as isolated PostgreSQL admin. The public
# access boundaries and real create/status/role RPCs were exercised above.
def admin_as(query,user):
 return sql(f"set request.jwt.claim.sub='{user}';set request.jwt.claim.session_id='{sessions[user]}';"+query)
aid='00000000-0000-4000-8000-000000008010';tid='00000000-0000-4000-8000-000000008011'
created=rpc('task_app_create_tasks',literal([{**fields,'title':'Coverage audit task'}]),owner)[0];tid=created['id']
admin_as(f"insert into public.account_member_absences(id,owner_id,member_id,category_id,expires_at)values('{aid}','{owner}','{mm}','{category}',now()+interval '2 days');",member)
check('Absence records affected identity',any(e['kind']=='absence_marked'and e['actorId']==mm for e in activity(owner,mm)['entries']))
admin_as(f"do $$begin insert into public.task_coverage_claims(task_id,absence_id,owner_id,original_member_id,taken_by_member_id)values('{tid}','{aid}','{owner}','{mm}','{cm}');update public.tasks set assigned_to_member_id='{cm}'where id='{tid}';end;$$;",coord)
check('Take records one event without duplicate reassignment',sum(e['kind']=='task_taken'and e['title']=='Coverage audit task'for e in activity()['entries'])==1 and not any(e['kind']=='task_reassigned'and e['title']=='Coverage audit task'for e in activity()['entries']))
version=sql(f"select updated_at from public.tasks where id='{tid}';")
rpc('task_app_mutate',f"'{tid}','{version}','status',null,'completed','this',null",coord)
check('Original member sees helper completion under Affecting',any(e['kind']=='task_completed'and e['actorId']==cm and e['title']=='Coverage audit task'for e in activity(owner,mm,'affecting')['entries']))
admin_as(f"update public.account_member_absences set previous_expires_at=expires_at,expires_at=statement_timestamp(),cancelled_at=statement_timestamp()where id='{aid}';",member)
check('Unmark recorded separately',any(e['kind']=='absence_unmarked'for e in activity(owner,mm)['entries']))
fid='00000000-0000-4000-8000-000000008020'
sql(f"insert into public.task_fines(id,owner_id,task_id,title,category_name,member_id,member_name,cutoff_at)values('{fid}','{owner}','{tid}','Coverage audit task','Revival Meeting','{mm}','Sarah New',now());")
admin_as(f"update public.task_fines set status='paid',settled_at=now(),settled_by_id='{cm}',settled_by_name='Daniel',updated_at=clock_timestamp()where id='{fid}';",coord)
check('Fine issue and payment each logged',set(e['kind']for e in activity(owner,mm,'affecting')['entries'])>=set(['fine_issued','fine_paid']))
template='00000000-0000-4000-8000-000000008030'
admin_as(f"insert into public.task_templates(id,owner_id,name,items)values('{template}','{owner}','Service prep',{literal([{'title':'Sound','notes':'Secret template notes'}])});",owner)
admin_as(f"update public.task_templates set deleted_at=clock_timestamp(),deleted_by_member_id='{ownmember}',deleted_by_name='Owner'where id='{template}';",owner)
admin_as(f"delete from public.task_templates where id='{template}';",owner)
check('Template events survive permanent deletion without notes',set(e['kind']for e in activity()['entries'])>=set(['template_created','template_moved','template_deleted'])and 'Secret template notes'not in json.dumps(activity()))
admin_as(f"insert into public.task_meeting_settings(owner_id,title)values('{owner}','Youth Meeting');",owner)
check('Shared Special Meeting title changes recorded',any(e['kind']=='meeting_title_changed'and e['title']=='Youth Meeting'for e in activity()['entries']))
# Internal occurrence housekeeping must not be misattributed as a manual edit.
before_count=sql('select count(*)from public.task_activity_log;')
sql(f"update public.tasks set available_at=clock_timestamp()where id='{tid}';")
check('Internal schedule updates do not become manual edits',before_count==sql('select count(*)from public.task_activity_log;'))
admin_as(f"select public.task_app_record_activity('{owner}','task_created',null,'Automatic repeat',null,'{{}}',{literal({'automatic':True})});",owner)
check('Automatic repeats are attributed to System',any(e['title']=='Automatic repeat'and e['actorName']=='System'and e['actorId']is None for e in activity()['entries']))
# More than one page, all timestamps equal, deterministic id tie-breaker.
sql(f"insert into public.task_activity_log(owner_id,kind,created_at)select '{owner}','task_created','2026-10-16T00:00:00Z'from generate_series(1,205);")
a=activity();last=a['entries'][-1];b=activity(before=last['createdAt'],before_id=last['id']);lastb=b['entries'][-1];c=activity(before=lastb['createdAt'],before_id=lastb['id'])
check('Cursor pagination does not duplicate or skip same-time events',a['hasMore']and b['hasMore']and len({e['id']for e in a['entries']+b['entries']+c['entries']})==a['total'])
checks=sql((root/'supabase/verification/20261016_activity_log_checks.sql').read_text())
check('Read-only security verification has zero violations',all(line.endswith('|0')for line in checks.splitlines()))
print('Activity SQL checks complete.',flush=True)
