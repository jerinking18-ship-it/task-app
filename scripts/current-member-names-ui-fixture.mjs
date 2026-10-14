// Isolated, credential-free rename QA. No hosted writes or authentication.
import './absence-ui-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve('.local-ui-fixture/workspace-ui'),file=path.join(dir,'fixture.json');
const data=JSON.parse(await readFile(file,'utf8'));
const owner='00000000-0000-4000-8000-000000000091',sarah='00000000-0000-4000-8000-000000000092',stamp='2026-10-14T06:00:00Z';
const base={...data.tasks[1],repeat_rule:'off',series_id:null,weekdays:[],assigned_to_member_id:owner,status:'completed',completed_at:stamp,completed_by_member_id:owner,completed_by_name:'Jerin',updated_at:stamp};
data.memberNames={};
data.tasks=[{...base,title:'Prepare the sound system'},{...base,id:'00000000-0000-4000-8000-000000000985',title:'Arrange the seating',claim_origin:{member_id:sarah,member_name:'Sarah',taken_by_member_id:owner}},{...base,id:'00000000-0000-4000-8000-000000000986',title:'Deleted sound notes',status:'active',completed_at:null,completed_by_member_id:null,completed_by_name:null,deleted_at:stamp,deleted_by_name:'Jerin',deleted_by_member_id:owner}];
data.templates=[{id:'00000000-0000-4000-8000-000000000888',name:'Welcome team setup',items:[{title:'Check the microphones',notes:'Ready for service'}],created_at:stamp,updated_at:stamp,deleted_at:stamp,deleted_by_name:'Jerin',deleted_by_member_id:owner}];
await writeFile(file,JSON.stringify(data));
for(const name of ['src/app/account/page.tsx','src/app/account/assigned-to-me/page.tsx','src/app/api/members/route.ts','src/app/api/presence/route.ts','src/app/api/tasks/route.ts','src/app/api/workspace/route.ts']){
 const target=path.join(dir,name);let source=await readFile(target,'utf8');
 const from="return {current:members.find(m=>m.role===role)??members[0],members,workspace:";
 const to="const currentMembers=members.map(m=>({...m,name:data.memberNames?.[m.id]??m.name}));return {current:currentMembers.find(m=>m.role===role)??currentMembers[0],members:currentMembers,workspace:";
 if(!source.includes(from))throw Error('Unexpected fixture state source '+name);
 source=source.replace(from,to);
 if(name==='src/app/api/members/route.ts')source+=`import {memberName} from '@/lib/members/model';export async function POST(request:Request){const action=await request.json();const state=await stateForRequest();const name=memberName(action.name);if(action.action!=='rename'||!name||action.previousName!==state.current.name)return Response.json({message:'Invalid or stale fictional rename'},{status:409});const data=await read();data.memberNames[state.current.id]=name;data.writes.push({action:'rename',memberId:state.current.id,name});await save(data);return Response.json(await stateForRequest());}`;
 await writeFile(target,source);
}
// Keep this report's old names deliberately: current directory must override them.
await writeFile(path.join(dir,'src/app/api/member-history/route.ts'),`export async function GET(){return Response.json({serverNow:new Date().toISOString(),members:[{id:'${owner}',name:'Jerin'},{id:'${sarah}',name:'Sarah'}],totals:[{memberId:'${owner}',year:2026,count:5}],entries:[],specialWindows:[]});}`);
console.log('Current-name fixture ready; rename only updates fictional local profile names.');
