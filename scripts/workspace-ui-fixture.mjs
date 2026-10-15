// Credential-free category deadline fixture; all writes affect only local fixture.json.
import {cp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=path.join(root,'.local-ui-fixture/workspace-ui');
await rm(dir,{recursive:true,force:true});
await mkdir(path.join(dir,'src/app/account'),{recursive:true});
for(const name of ['tasks','bin','members','templates','presence'])await mkdir(path.join(dir,'src/app/api',name),{recursive:true});
await mkdir(path.join(dir,'src/app/auth/submit'),{recursive:true});
await cp(path.join(root,'src/components'),path.join(dir,'src/components'),{recursive:true});
await cp(path.join(root,'src/lib'),path.join(dir,'src/lib'),{recursive:true});
for(const name of ['package.json','tsconfig.json','src/app/globals.css'])await cp(path.join(root,name),path.join(dir,name));
await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
await writeFile(path.join(dir,'next.config.ts'),(await readFile(path.join(root,'next.config.ts'),'utf8')).replace('root: process.cwd()',`root: ${JSON.stringify(root)}`).replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = { devIndicators: false,'));
await writeFile(path.join(dir,'src/app/layout.tsx'),`import './globals.css';import {FixtureClock} from '@/lib/fixture-clock';export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><FixtureClock>{children}</FixtureClock></body></html>}`);
await writeFile(path.join(dir,'src/lib/fixture-clock.tsx'),`"use client";import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';const Context=createContext<[Date,(value:Date)=>void]>([new Date('2026-10-12T23:49:58+05:30'),()=>{}]);export function useFixtureClock(){return useContext(Context);}export function FixtureClock({children}:{children:ReactNode}){const [now,setNow]=useState(()=>new Date('2026-10-12T23:49:58+05:30'));const [input,setInput]=useState('2026-10-12T23:49:58');const [running,setRunning]=useState(false);const [hidden,setHidden]=useState(false);useEffect(()=>{if(!running)return;const id=setInterval(()=>setNow(value=>new Date(value.getTime()+1000)),1000);return()=>clearInterval(id);},[running]);return <Context.Provider value={[now,()=>{}]}>{!hidden&&<div style={{position:'fixed',zIndex:5000,bottom:92,left:8,background:'#fff',border:'1px solid #bbb',padding:6,fontSize:11,maxWidth:350}}><label>Fictional test clock (IST)<input aria-label="Fictional test clock (IST)" type="text" step="1" value={input} onChange={e=>setInput(e.target.value)}/></label><button onClick={()=>{setRunning(false);setNow(new Date(input+'+05:30'));}}>Set test time</button><button onClick={()=>setRunning(v=>!v)}>{running?'Pause test clock':'Run test clock'}</button><output aria-label="Test time">{new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',dateStyle:'short',timeStyle:'medium'}).format(now)}</output><button onClick={()=>setHidden(true)}>Hide test controls</button></div>}{children}</Context.Provider>;}`);
const taskAppCopy=path.join(dir,'src/components/task-app.tsx');let copy=await readFile(taskAppCopy,'utf8');copy=copy.replace('const [now,setNow]=useState(()=>new Date());','const [now,setNow]=useState(()=>new Date());').replace('import Link from \"next/link\";','import Link from \"next/link\";\nimport {useFixtureClock} from \"@/lib/fixture-clock\";');await writeFile(taskAppCopy,copy);
const stampNow=new Date().toISOString();
const member={id:'00000000-0000-4000-8000-000000000091',name:'Jerin',role:'owner',createdAt:stampNow,lastSeenAt:stampNow,activeUntil:new Date(Date.now()+600000).toISOString()};
const sarah={...member,id:'00000000-0000-4000-8000-000000000092',name:'Sarah',role:'member',activeUntil:null};
const daniel={...member,id:'00000000-0000-4000-8000-000000000093',name:'Daniel',role:'coordinator',activeUntil:null};
const membersState={current:member,members:[member,sarah,daniel],workspace:{id:'00000000-0000-4000-8000-000000000090',ownerId:'00000000-0000-4000-8000-000000000001',name:'BGM Workspace',reservedSeats:0},invitations:[],serverNow:stampNow};
const stateSource=`import {cookies} from 'next/headers';const state=${JSON.stringify(membersState)};async function stateForRequest(){const role=(await cookies()).get('fixture_role')?.value;return {...state,current:state.members.find(m=>m.role===role)??state.members[0],serverNow:new Date().toISOString()};}`;
await writeFile(path.join(dir,'src/app/account/page.tsx'),stateSource+`import TaskApp from '@/components/task-app';export default async function Page(){return <TaskApp saved today="2026-10-14" initialMembers={await stateForRequest()} accountEmail="fictional@example.test"/>}`);
await mkdir(path.join(dir,'src/app/account/assigned-to-me'),{recursive:true});
await writeFile(path.join(dir,'src/app/account/assigned-to-me/page.tsx'),stateSource+`import TaskApp from '@/components/task-app';export default async function Page(){return <TaskApp saved initialView="Assigned to me" today="2026-10-14" initialMembers={await stateForRequest()} accountEmail="fictional@example.test"/>}`);
await writeFile(path.join(dir,'src/app/api/members/route.ts'),stateSource+`export async function GET(){return Response.json(await stateForRequest());}`);
await writeFile(path.join(dir,'src/app/api/presence/route.ts'),stateSource+`export async function POST(){return Response.json(await stateForRequest());}`);
await writeFile(path.join(dir,'src/app/auth/submit/route.ts'),`export async function POST(){return Response.json({redirectTo:'/account'});}`);
await mkdir(path.join(dir,'src/app/fixture/[role]'),{recursive:true});
await writeFile(path.join(dir,'src/app/fixture/[role]/route.ts'),`import {NextResponse} from 'next/server';export async function GET(request:Request,{params}:{params:Promise<{role:string}>}){const {role}=await params;const r=NextResponse.redirect(new URL('/account','http://127.0.0.1:3028'));r.cookies.set('fixture_role',['owner','coordinator','member'].includes(role)?role:'owner');return r;}`);
await mkdir(path.join(dir,'src/app/api/workspace'),{recursive:true});
await writeFile(path.join(dir,'src/app/api/workspace/route.ts'),stateSource+`export async function POST(request:Request){const action=await request.json();if((await stateForRequest()).current.role!=='owner')return Response.json({message:'Your current role does not allow this action.'},{status:403});if(action.action==='invite')return Response.json({token:'a'.repeat(64),expires_at:new Date(Date.now()+7*86400000).toISOString(),id:crypto.randomUUID()});return Response.json(await stateForRequest());}`);
await mkdir(path.join(dir,'src/app/api/member-history'),{recursive:true});
await writeFile(path.join(dir,'src/app/api/member-history/route.ts'),`export async function GET(){return Response.json({serverNow:new Date().toISOString(),members:${JSON.stringify(membersState.members.map(m=>({id:m.id,name:m.name})))},totals:[],entries:[],specialWindows:[]});}`);
const categoryNames=['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting'];
const categories=categoryNames.map((name,index)=>({id:`00000000-0000-4000-8000-${String(100+index).padStart(12,'0')}`,name}));
const stamp='2026-10-11T07:25:00Z';const today='2026-10-12';
const base={notes:'Review the team and meeting details',status:'active',due_date:today,due_time:'12:55:00',priority:'medium',weekdays:[],repeat_rule:'off',series_id:null,history_at:null,available_at:null,repeat_anchor_day:null,created_at:stamp,updated_at:stamp,completed_at:null,completed_by_member_id:null,completed_by_name:null,deleted_at:null,deleted_by_name:null};
const specs=[['Sunday completed','2026-10-11','12:55:00',true],['Sunday overdue','2026-10-11','12:55:00',false],['Due at the category reset','2026-10-12','23:50:00',false],['Another task due at reset','2026-10-12','23:50:00',false],['Next repeating occurrence','2026-10-18','23:50:00',false]];
let tasks=specs.map(([title,date,time,done],index)=>({...base,id:`00000000-0000-4000-8000-${String(300+index).padStart(12,'0')}`,title,notes:'Fictional deadline test; this task stays saved.',category_id:categories[0].id,due_date:date,due_time:time,status:done?'completed':'active',completed_at:done?stamp:null,completed_by_member_id:done?member.id:null,completed_by_name:done?member.name:null,...(index===4?{available_at:'2026-10-17T18:30:00Z',repeat_rule:'weekly',weekdays:[0],series_id:'00000000-0000-4000-8000-000000000701'}:{})}));
tasks=tasks.map((task,index)=>({...task,assigned_to_member_id:index===1?sarah.id:member.id}));
tasks.push({...tasks[0],id:'00000000-0000-4000-8000-000000000399',title:'Archived meeting notes',deleted_at:new Date().toISOString(),deleted_by_name:'Jerin',status:'active',completed_at:null,completed_by_name:null,completed_by_member_id:null,assigned_to_member_id:sarah.id});
const templates=[{id:'00000000-0000-4000-8000-000000000800',name:'Meeting setup',items:[{title:'Prepare chairs',notes:'Set out the seating'},{title:'Test sound',notes:'Check the microphones'}],created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null,deleted_by_name:null}];
await writeFile(path.join(dir,'fixture.json'),JSON.stringify({tasks,templates,categories,timezone:'Asia/Kolkata',failRead:false,failWrite:false,badConfirmation:false,writes:[]}));
const shared=`import {readFile,writeFile} from 'node:fs/promises';const file=process.cwd()+'/fixture.json';const read=async()=>JSON.parse(await readFile(file,'utf8'));const save=async(data:unknown)=>writeFile(file,JSON.stringify(data));const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});`;
await writeFile(path.join(dir,'src/app/api/tasks/route.ts'),shared+stateSource+`
import {validateAction} from '@/lib/tasks/validation';
export async function GET(){const data=await read();return data.failRead?json({message:'Local fixture load unavailable'},503):json({...data,tasks:data.tasks.filter((t:{deleted_at:string|null})=>!t.deleted_at)});}
export async function POST(request:Request){const data=await read();const input=validateAction(await request.json());if(!input)return json({message:'Invalid fixture input'},400);if(data.failWrite)return json({message:'Local fixture write unavailable'},503);let result:unknown={};const stamp=new Date().toISOString();
 if(input.action==='bootstrap')return json({categories:data.categories});
 if(input.action==='setup'){data.timezone=input.timezone;result={timezone:data.timezone};}
 if(input.action==='create'||input.action==='create_many'){const fields=input.action==='create'?[input.fields]:input.fields;const rows=fields.map(field=>({...field,id:crypto.randomUUID(),created_at:stamp,updated_at:stamp,completed_at:null,deleted_at:null,deleted_by_name:null,series_id:field.repeat_rule!=='off'?crypto.randomUUID():null,repeat_anchor_day:field.repeat_rule==='monthly'?Number(field.due_date?.slice(-2)):null}));data.tasks.push(...rows);result=input.action==='create'?{task:rows[0]}:{tasks:rows};}
 if(input.action==='delete'||input.action==='update'||input.action==='status'){const task=data.tasks.find((t:{id:string;deleted_at:string|null})=>t.id===input.id&&!t.deleted_at);if(!task)return json({message:'Task unavailable'},404);if(task.updated_at!==input.version)return json({message:'Task changed elsewhere',latest:task,categories:data.categories},409);if(input.action==='delete'){task.deleted_at=stamp;task.deleted_by_name='Example';result={deleted:task.id};}else{Object.assign(task,input.action==='update'?input.fields:{status:input.status});task.completed_at=task.status==='completed'?(task.completed_at||stamp):null;task.completed_by_member_id=task.status==='completed'?(await stateForRequest()).current.id:null;task.completed_by_name=task.status==='completed'?(await stateForRequest()).current.name:null;result={task};}task.updated_at=stamp;}
 data.writes.push({action:input.action,at:stamp});await save(data);return json(result);}
`);
await writeFile(path.join(dir,'src/app/api/bin/route.ts'),shared+`
import {validateBinAction} from '@/lib/tasks/bin';
export async function GET(){const data=await read();return data.failRead?json({message:'Local Bin unavailable'},503):json({tasks:data.tasks.filter((t:any)=>!!t.deleted_at),templates:data.templates.filter((t:any)=>!!t.deleted_at),categories:data.categories});}
export async function POST(request:Request){const data=await read();const input=validateBinAction(await request.json());if(!input)return json({message:'Invalid Bin selection'},400);if(data.failWrite)return json({message:'Local Bin write unavailable'},503);
 const find=(item:any)=>(item.kind==='template'?data.templates:data.tasks).find((t:any)=>t.id===item.id&&t.deleted_at&&t.updated_at===item.version);
 if(!input.items.every(find))return json({message:'A selected item changed. Refresh and select again. No items were changed.'},409);
 for(const item of input.items){const row=find(item);if(input.action==='purge'){if(item.kind==='template')data.templates=data.templates.filter((t:any)=>t.id!==item.id);else data.tasks=data.tasks.filter((t:any)=>t.id!==item.id);}else{row.deleted_at=null;row.deleted_by_name=null;if(item.kind!=='template')row.history_at=null;row.updated_at=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();}}
 data.writes.push({action:input.action,items:input.items,at:new Date().toISOString()});await save(data);
 return json({action:input.action,items:data.badConfirmation?[]:input.items.map(item=>({kind:item.kind??'task',id:item.id}))});}
`);

await writeFile(path.join(dir,'src/app/api/templates/route.ts'),shared+`
import {validateTemplateMutation} from '@/lib/templates/model';
export async function GET(){const data=await read();return data.failRead?json({message:'Local templates unavailable'},503):json({templates:data.templates.filter((t:any)=>!t.deleted_at)});}
export async function POST(request:Request){const data=await read();const input=validateTemplateMutation(await request.json());if(!input)return json({message:'Invalid template input'},400);if(data.failWrite)return json({message:'Template action could not be confirmed. Refresh before retrying.'},503);
 const existing=data.templates.find((t:any)=>t.id===input.id);const stamp=new Date(Math.max(Date.now(),Date.parse(existing?.updated_at??'1970-01-01')+1)).toISOString();
 if(input.action==='remove'){if(!existing||existing.deleted_at||existing.updated_at!==input.version)return json({message:'This template changed elsewhere. Close and refresh templates.'},409);existing.deleted_at=stamp;existing.deleted_by_name='Daniel';existing.updated_at=stamp;data.writes.push({action:'template_remove',id:input.id,at:stamp});await save(data);return json({removed:data.badConfirmation?{}:{id:existing.id,updated_at:stamp,deleted_at:stamp}});}
 if(existing?.deleted_at||(input.action==='update'&&(!existing||existing.updated_at!==input.version)))return json({message:'This template changed elsewhere. Close and refresh templates.'},409);
 if(input.action==='create'&&existing)return JSON.stringify(existing.items)===JSON.stringify(input.items)&&existing.name===input.name?json({template:existing}):json({message:'Template changed elsewhere.'},409);
 const template={id:input.id,name:input.name,items:input.items,created_at:existing?.created_at??stamp,updated_at:stamp,deleted_at:null,deleted_by_name:null};data.templates=[template,...data.templates.filter((t:any)=>t.id!==input.id)];data.writes.push({action:'template_'+input.action,at:stamp});await save(data);return json({template});}
`);
console.log('Fictional category deadline fixture: http://127.0.0.1:3028/account');
const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3028'],{cwd:dir,stdio:'inherit',env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code??0;});
