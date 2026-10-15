// Credential-free profile UI QA; all states and writes are local fictional data.
import './workspace-ui-fixture.mjs';
import {mkdir,readFile,writeFile}from'node:fs/promises';
import path from'node:path';
const dir=path.resolve('.local-ui-fixture/workspace-ui');
const file=path.join(dir,'fixture.json'),data=JSON.parse(await readFile(file,'utf8'));
const original=await readFile(path.join(dir,'src/app/account/assigned-to-me/page.tsx'),'utf8');
const memberState=JSON.parse(original.match(/const state=(.*?);async function stateForRequest/s)[1]);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
data.clock='2026-10-18T12:00:00+05:30';
memberState.absences=[{id:id(980),memberId:memberState.current.id,categoryId:data.categories.find(c=>c.name==='Sunday Service').id,category:'Sunday Service',meetingDate:null,createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-19T23:50:00+05:30'},{id:id(981),memberId:memberState.current.id,categoryId:data.categories.find(c=>c.name==='Special Meeting').id,category:'Special Meeting',meetingDate:'2026-10-18',createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-19T23:50:00+05:30'}];
data.memberState=memberState;await writeFile(file,JSON.stringify(data));
const stateSource=`import fs from 'node:fs/promises';import path from 'node:path';import {cookies}from'next/headers';const file=path.join(process.cwd(),'fixture.json');const read=async()=>JSON.parse(await fs.readFile(file,'utf8'));async function stateForRequest(){const data=await read();const state=data.memberState;const role=(await cookies()).get('fixture_role')?.value;return {...state,current:state.members.find((m:any)=>m.role===role)??state.members[0],serverNow:new Date(data.clock).toISOString(),absences:state.absences.filter((a:any)=>Date.parse(a.createdAt)<=Date.parse(data.clock)&&Date.parse(a.expiresAt)>Date.parse(data.clock))};}`;
await mkdir(path.join(dir,'src/app/account/profile'),{recursive:true});
await writeFile(path.join(dir,'src/app/account/profile/page.tsx'),stateSource+`import TaskApp from '@/components/task-app';export default async function Page(){return <TaskApp saved initialView="My profile" today="2026-10-18" initialMembers={await stateForRequest()} accountEmail="fictional@example.test"/>}`);
await writeFile(path.join(dir,'src/app/api/members/route.ts'),stateSource+`export async function GET(){return Response.json(await stateForRequest());}`);
await writeFile(path.join(dir,'src/app/api/presence/route.ts'),stateSource+`export async function POST(){return Response.json(await stateForRequest());}`);
await writeFile(path.join(dir,'src/app/api/workspace/route.ts'),stateSource+`
import {workspaceAction}from'@/lib/workspace/model';import{overviewDeadline}from'@/lib/tasks/meeting-overview';
export async function POST(request:Request){const input=workspaceAction(await request.json());const data=await read(),state=await stateForRequest();if(data.failWrite)return Response.json({message:'Local attendance unavailable. Close and refresh.'},{status:503});if(!input)return Response.json({message:'Invalid request'},{status:400});
if(input.action==='unmarkAbsent'){const a=data.memberState.absences.find((a:any)=>a.id===input.id);if(!a||a.memberId!==state.current.id||a.expiresAt!==input.expiresAt)return Response.json({message:'Attendance changed. Close and refresh.'},{status:409});a.expiresAt=data.clock;data.writes.push({action:input.action,id:a.id});}
else if(input.action==='absent'){const c=data.categories.find((c:any)=>c.id===input.categoryId);if(!c)return Response.json({message:'Invalid meeting'},{status:400});const deadline=c.name==='Special Meeting'?new Date(Date.parse(input.meetingDate+'T23:50:00+05:30')+86400000).toISOString():new Date(overviewDeadline(c.name,new Date(data.clock))!.resetAt).toISOString();data.memberState.absences.push({id:crypto.randomUUID(),memberId:state.current.id,categoryId:c.id,category:c.name,meetingDate:input.meetingDate,createdAt:data.clock,expiresAt:deadline});data.writes.push({action:input.action,category:c.name});}
else return Response.json({message:'Fixture only supports attendance'},{status:400});await fs.writeFile(file,JSON.stringify(data));return Response.json(await stateForRequest());}
`);
console.log('Fictional profile attendance ready at http://127.0.0.1:3028/account/profile; no hosted connection.');
