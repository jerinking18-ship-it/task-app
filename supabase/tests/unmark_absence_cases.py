# Executed only inside the offline disposable absence_coverage.py harness.
current=next(v for v in rpc('task_app_member_state','',member)['absences']if v['id']==a['id'])
returned=create(title='Returns to original control')
old_expiry=current['expires_at']
def unmark(absence,who=member,expiry=None,confirmed=True):
 return rpc('task_app_unmark_absent',f"'{absence['id']}','{expiry or absence['expires_at']}',{str(confirmed).lower()}",who)
q=f"select public.task_app_unmark_absent('{a['id']}','{old_expiry}',true);"
expect('self-unmark requires verified email',q,unverified,'P0403')
expect('self-unmark requires workspace',q,users[6],'P0403')
expect('another workspace cannot unmark',q,outsider,'P0409')
expect('Owner cannot unmark another member',q,owner,'P0403')
expect('Coordinator cannot unmark another member',q,coord,'P0403')
expect('unmark requires explicit confirmation',q.replace(',true)',',false)'),member,'23514')
expect('unmark rejects stale expiry',q.replace(old_expiry,'2020-01-01T00:00:00Z'),member,'P0409')
expect('unmark rejects infinite expiry',q.replace(old_expiry,'infinity'),member,'23514')
check('anonymous unmark not executable',sql("select has_function_privilege('anon','public.task_app_unmark_absent(uuid,timestamptz,boolean)','execute');")=='f')
check('service role unmark not executable',sql("select has_function_privilege('service_role','public.task_app_unmark_absent(uuid,timestamptz,boolean)','execute');")=='f')
series_before=sql(f"select assigned_to_member_id from public.task_series where id='{repeat['series_id']}';")
claims_before=sql(f"select count(*)from public.task_coverage_claims where absence_id='{a['id']}';")
sync_before=int(sql(f"select count(*)from realtime.messages where topic='task-account:{owner}';"))
back=unmark(current)
check('return sends task and member invalidations',int(sql(f"select count(*)from realtime.messages where topic='task-account:{owner}';"))==sync_before+2)
check('returned absence disappears from immediate response',not any(v['id']==a['id']for v in back['absences']))
check('all members see returned attendance removed',not any(v['id']==a['id']for v in rpc('task_app_member_state','',wrong)['absences']))
check('unclaimed task leaves Needs help',not any(v['task_id']==returned['id']for v in rpc('task_app_available_coverage','',wrong)))
check('return preserves original expiry and actual end',sql(f"select cancelled_at=expires_at and previous_expires_at='{old_expiry}'::timestamptz and cancelled_at>created_at from public.account_member_absences where id='{a['id']}';")=='t')
check('return preserves claimed task provenance and assignment',sql(f"select count(*)from public.task_coverage_claims where absence_id='{a['id']}';")==claims_before and sql(f"select assigned_to_member_id from public.tasks where id='{reopened['id']}';")==hm and origin_for(reopened['id'])['member_id']==mm)
check('return never changes future series assignment',sql(f"select assigned_to_member_id from public.task_series where id='{repeat['series_id']}';")==series_before)
status(returned,'completed',owner,'P0403');returned_done=status(returned,'completed',member)
check('original member can complete returned unclaimed task',returned_done['completed_by_member_id']==mm)
take(create(title='Old claim denied after return'),a['id'],wrong,fail='P0409')
check('unmark retry is idempotent',not any(v['id']==a['id']for v in unmark(current)['absences']))
# Preserve the past 5 AM absence exemption while allowing future liability
# after the member returns. All time overrides are local PostgreSQL only.
sql(f"update public.account_member_absences set created_at=now()-interval '2 days'where id='{a['id']}';update public.task_fine_configuration set enabled_at=now()-interval '3 days';")
for n,interval in [(990,'-1 hour'),(991,'1 hour')]:
 sql(f"insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,completed,deleted,created_at)values('{owner}','00000000-0000-4000-8000-{n:012}','Return fine test','{category}','Healing Meeting','{mm}','Sarah',current_date,now()-interval '2 hours',now()+interval '{interval}',false,false,now()-interval '2 days');")
sql(f"select public.task_app_assess_fines('{owner}',now()+interval '2 hours');")
check('return preserves historical pre-return fine exemption',sql("select count(*)from public.task_fines where task_id='00000000-0000-4000-8000-000000000990';")=='0')
check('post-return future fine cutoff uses ended absence interval',sql("select count(*)from public.task_fines where task_id='00000000-0000-4000-8000-000000000991';")=='1')
fine_digest=sql("select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by id),''))from public.task_fines f;")
next_state=rpc('task_app_mark_absent',f"'{category}',null,true",member)
next_a=next(v for v in next_state['absences']if v['category_id']==category and v['member_id']==mm)
check('can mark same meeting absent again with a new interval',next_a['id']!=a['id'])
check('retrying old unmark cannot cancel a new absence',any(v['id']==next_a['id']for v in unmark(current)['absences']))
check('mark/unmark do not alter issued fine ledger',sql("select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by id),''))from public.task_fines f;")==fine_digest)
# An actual cutoff during a delayed return commit must not retain a stale exemption.
fine_race_id='00000000-0000-4000-8000-000000000992'
sql(f"insert into public.task_fine_candidates(owner_id,task_id,title,category_id,category_name,member_id,member_name,scheduled_date,due_at,cutoff_at,completed,deleted,created_at)values('{owner}','{fine_race_id}','Return across fine cutoff','{category}','Healing Meeting','{mm}','Sarah',current_date,now()-interval '2 hours',now()+interval '2 seconds',false,false,now()-interval '2 days');")
with concurrent.futures.ThreadPoolExecutor(max_workers=1)as pool:
 delayed=pool.submit(sql,f"begin;select public.task_app_unmark_absent('{next_a['id']}','{next_a['expires_at']}',true);select pg_sleep(3.2);commit;",member)
 time.sleep(2.3)
 sql('select public.task_app_assess_scheduled_fines();')
 delayed.result()
sql('select public.task_app_assess_scheduled_fines();')
check('return committed across cutoff keeps correct future fine liability',sql(f"select count(*)from public.task_fines where task_id='{fine_race_id}';")=='1')
check('fine race used a pre-cutoff return',sql(f"select a.cancelled_at<c.cutoff_at from public.account_member_absences a cross join public.task_fine_candidates c where a.id='{next_a['id']}'and c.task_id='{fine_race_id}';")=='t')
next_state=rpc('task_app_mark_absent',f"'{category}',null,true",member)
next_a=next(v for v in next_state['absences']if v['category_id']==category and v['member_id']==mm)

# Concurrent claim vs return: if claim wins, keep it; otherwise deny the claim.
race_return=create(title='Concurrent take versus unmark')
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 def return_contender(kind):
  try:return ('return',unmark(next_a))if kind=='return'else('claim',take(race_return,next_a['id'],wrong))
  except AssertionError as e:return('denied',str(e))
 answers=list(pool.map(return_contender,['return','claim']))
check('concurrent return always completes',any(kind=='return'for kind,value in answers))
check('claim and return serialize without losing provenance',sql(f"select count(*)from public.task_coverage_claims where task_id='{race_return['id']}';")in('0','1')and sql(f"select assigned_to_member_id from public.tasks where id='{race_return['id']}';")in(mm,hm))
check('no availability remains after concurrent return',not any(v['task_id']==race_return['id']for v in rpc('task_app_available_coverage','',wrong)))
# Restore a live absence for the harness's remaining legacy expiry tests.
restored=rpc('task_app_mark_absent',f"'{category}',null,true",member)
a=next(v for v in restored['absences']if v['category_id']==category and v['member_id']==mm)
print('All new self-unmark integration checks passed.',flush=True)

verification=sql((root/'supabase/verification/20261015_unmark_absence_schema_checks.sql').read_text())
check('self-return schema security verification',all(line.split('|')[1]=='0'for line in verification.splitlines()))
