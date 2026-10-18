import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,deps={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require:n=>{if(n in deps)return deps[n];throw Error(n);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const id='00000000-0000-4000-8000-000000000001',source='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',version='2026-10-18T12:00:00Z',token='a'.repeat(32),fields={title:'Prepare sound',notes:null,status:'active',due_date:null,due_time:null,priority:'medium',category_id:null,weekdays:[],repeat_rule:'off',assigned_to_member_id:target};
test('bulk confirmation validates scope, identity, snapshot and active status without accepting hidden edits',()=>{
 const base={action:'reassign_all',id,version,fields,snapshot:token,assignmentScope:'this',confirmed:true};
 assert.ok(validation.validateAction(base));assert.ok(validation.validateAction({...base,assignmentScope:'future'}));
 for(const patch of [{confirmed:false},{snapshot:'bad'},{assignmentScope:'all'},{id:'bad'},{scope:'future'},{specialStart:{}},{fields:{...fields,status:'completed'}},{fields:{...fields,assigned_to_member_id:null}}])assert.equal(validation.validateAction({...base,...patch}),null);
 assert.ok(validation.validateAction({action:'reassign_preview',id,version}));assert.equal(validation.validateAction({action:'reassign_preview',id,version,sourceId:source}),null);
});
test('server preview counts must be complete and internally consistent',()=>{
 assert.equal(validation.decodeReassignmentSnapshot({sourceId:source,count:3,repeatCount:2,token}).count,3);
 for(const patch of [{count:0},{count:10001},{count:1.5},{repeatCount:4},{repeatCount:-1},{token:'bad'},{sourceId:target.slice(1)}])assert.throws(()=>validation.decodeReassignmentSnapshot({sourceId:source,count:3,repeatCount:2,token,...patch}));
});
test('preview uses one manager-gated RPC and rejects malformed responses',async()=>{
 const {TaskRepository}=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});let calls=[];
 const repo=new TaskRepository({rpc:async(name,args)=>{calls.push({name,args});return{data:{sourceId:source,count:3,repeatCount:2,token},error:null};}},id);
 assert.equal((await repo.mutate({action:'reassign_preview',id,version})).snapshot.count,3);assert.equal(calls[0].name,'task_app_reassignment_preview');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)),{task_id:id,expected_version:version});
 const bad=new TaskRepository({rpc:async()=>({data:{sourceId:source,count:0,repeatCount:0,token},error:null})},id);await assert.rejects(()=>bad.mutate({action:"reassign_preview",id,version}));
});
test('bulk stale selection is a conflict with no automatic replay or partial-read success',async()=>{
 const {TaskRepository}=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});let calls=0;
 const repo=new TaskRepository({rpc:async(name,args)=>{calls++;assert.equal(name,'task_app_reassign_all');assert.equal(args.assignment_future,true);assert.equal(args.expected_snapshot,token);return{error:{code:'P0039'},data:null};}},id);
 await assert.rejects(()=>repo.mutate({action:'reassign_all',id,version,fields,snapshot:token,assignmentScope:'future',confirmed:true}),e=>e.status===409&&e.message.includes('No tasks were reassigned'));assert.equal(calls,1);
});
