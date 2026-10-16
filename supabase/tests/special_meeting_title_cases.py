check('migration does not backfill workspace titles',sql('select count(*)from public.task_meeting_settings;')=='0')
for user in [owner,coord,member,outsider]:check('verified member reads unset own-workspace title',rpc('task_app_special_meeting_title','',user)=={'title':None,'version':None})
sql('select public.task_app_special_meeting_title();',unverified,fail='P0403')
rpc('task_app_setup',"'bootstrap',null",owner)
category=sql(f"select id from public.categories where owner_id='{owner}'and name='Special Meeting';")
fields={'title':'Fictional named meeting task','notes':'Keep existing data','status':'active','due_date':None,'due_time':None,'priority':'medium','category_id':category,'weekdays':[],'repeat_rule':'off','assigned_to_member_id':mm,'sunday_service':None}
t=rpc('task_app_create_tasks',literal([fields]),owner)[0]
def baseline():return sql("select md5(jsonb_build_object('tasks',(select jsonb_agg(t order by id)from public.tasks t),'categories',(select jsonb_agg(c order by id)from public.categories c),'series',(select jsonb_agg(s order by id)from public.task_series s),'pending',(select jsonb_agg(p order by id)from public.task_repeat_pending p),'fines',(select jsonb_agg(f order by id)from public.task_fines f),'accounts',(select jsonb_agg(u order by id)from auth.users u))::text);")
before=baseline()
def query(title,version):return "select public.task_app_set_special_meeting_title("+"'"+title.replace("'","''")+"',"+("'"+version+"'"if version else'null')+");"
def save(title,version=None,user=owner):return json.loads(sql(query(title,version),user))
sql(query('Youth Meeting',None),member,fail='P0403')
first=save(' Youth Meeting ');check('Owner sets first shared title with server version',first['title']=='Youth Meeting'and first['version']is not None)
for user in [owner,coord,member]:check('shared title visible to all workspace roles',rpc('task_app_special_meeting_title','',user)==first)
check('other workspace cannot see this title',rpc('task_app_special_meeting_title','',outsider)=={'title':None,'version':None})
second=save('Christmas Service',first['version'],coord);check('Coordinator edits same shared title',second['title']=='Christmas Service'and second['version']>first['version'])
stale=save('Stale edit',first['version']);check('stale version preserves saved title',stale.get('conflict')is True and stale['latest']==second and rpc('task_app_special_meeting_title','',member)==second)
for bad in ['x'*61,'A\nB','A\tB','A'+chr(8232)+'B']:
 sql(query(bad,second['version']),owner,fail='23514')
 check('invalid title does not overwrite shared value',rpc('task_app_special_meeting_title','',owner)==second)
# The same expected version cannot silently overwrite a simultaneous edit.
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 results=list(pool.map(lambda name:save(name,second['version']),['Youth Retreat','Prayer Gathering']))
wins=[v for v in results if not v.get('conflict')];losers=[v for v in results if v.get('conflict')]
check('concurrent title edits yield one save and one reviewable conflict',len(wins)==1 and len(losers)==1 and losers[0]['latest']==wins[0])
cleared=save('',wins[0]['version'],coord);check('blank custom name restores default without deleting setting',cleared['title']is None and cleared['version']is not None)
check('renaming/clearing preserves tasks/categories/assignments/repeats/fines/accounts',baseline()==before)
for role in ['anon','authenticated','service_role']:
 for privilege in ['select','insert','update','delete']:
  check(role+' cannot directly '+privilege+' meeting settings',sql(f"select has_table_privilege('{role}','public.task_meeting_settings','{privilege}');")=='f')
for role,want in [('anon','f'),('authenticated','t'),('service_role','f')]:
 for signature in ['task_app_special_meeting_title()','task_app_set_special_meeting_title(text,timestamptz)']:
  check(role+' RPC grant '+signature,sql(f"select has_function_privilege('{role}','public.{signature}','execute');")==want)
sql('select * from public.task_meeting_settings;',member,fail='42501')
sql(f"update public.task_meeting_settings set title='Bypass'where owner_id='{owner}';",owner,fail='42501')
check('settings table has RLS and task sync trigger',sql("select relrowsecurity from pg_class where oid='public.task_meeting_settings'::regclass;")=='t'and sql("select count(*)from pg_trigger where tgrelid='public.task_meeting_settings'::regclass and tgname='special_meeting_title_sync'and not tgisinternal;")=='1')
sql((root/'supabase/migrations/202610160033_special_meeting_title.sql').read_text(),fail='Meeting title is already installed')
check('migration replay refuses without altering saved title',rpc('task_app_special_meeting_title','',owner)==cleared)
checks=sql((root/'supabase/verification/20261016_special_meeting_title_checks.sql').read_text()).splitlines()
check('all read-only title deployment checks zero',len(checks)==6 and all(value.endswith('|0')for value in checks))
