// Local UI QA only. Copies client source into an ignored, credential-free project.
// Its /api/tasks route writes only fixture.json, never Supabase. Stop with Ctrl-C.
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
const dir=path.join(root,".local-ui-fixture");
await rm(dir,{recursive:true,force:true});
await mkdir(path.join(dir,"src/app/account"),{recursive:true});
await mkdir(path.join(dir,"src/app/api/tasks"),{recursive:true});
await mkdir(path.join(dir,"src/app/auth/submit"),{recursive:true});
await mkdir(path.join(dir,"src/app/sign-in"),{recursive:true});
await cp(path.join(root,"src/components"),path.join(dir,"src/components"),{recursive:true});
await cp(path.join(root,"src/lib/tasks"),path.join(dir,"src/lib/tasks"),{recursive:true});
// Server repositories are not needed in this isolated client fixture.
await rm(path.join(dir,"src/lib/tasks/repository.ts"));
await mkdir(path.join(dir,"src/lib/auth"),{recursive:true});
await cp(path.join(root,"src/lib/auth/validation.ts"),path.join(dir,"src/lib/auth/validation.ts"));
for(const file of ["package.json","tsconfig.json","src/app/globals.css","src/app/page.tsx"])
  await cp(path.join(root,file),path.join(dir,file));
await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
const config=(await readFile(path.join(root,"next.config.ts"),"utf8")).replace("root: process.cwd()",`root: ${JSON.stringify(root)}`);
await writeFile(path.join(dir,"next.config.ts"),config);
await writeFile(path.join(dir,"src/proxy.ts"),`import {NextResponse} from 'next/server'; export function proxy(){return NextResponse.next();}`);
await writeFile(path.join(dir,"src/app/layout.tsx"),`import './globals.css';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><div style={{padding:8,background:'#e9d6a8',color:'#101c2d',fontSize:12,textAlign:'center'}}>LOCAL UI FIXTURE · No real account or Supabase connection</div>{children}</body></html>}`);
await writeFile(path.join(dir,"src/app/account/page.tsx"),`import TaskApp from '@/components/task-app';
export default function Fixture(){return <TaskApp saved today="2026-10-12"/>}`);
await writeFile(path.join(dir,"src/app/sign-in/page.tsx"),`import AuthShell from '@/components/auth/auth-shell'; import AuthForm from '@/components/auth/auth-form'; export default function Page(){return <AuthShell eyebrow="PRAISE THE LORD" title="Sign in to Task App" description="Your tasks, right where you left them."><AuthForm/></AuthShell>}`);
await writeFile(path.join(dir,"src/app/auth/submit/route.ts"),`export async function POST(req:Request){const input=await req.json(); return input.action==='sign-out'?Response.json({redirectTo:'/sign-in'}):Response.json({message:'Local fixture: credential submission disabled.'},{status:403});}`);
await writeFile(path.join(dir,"fixture.json"),JSON.stringify({tasks:[],categories:[],timezone:null,failRead:false,failWrite:false,ambiguousCreate:false,delay:0}));
await writeFile(path.join(dir,"src/app/api/tasks/route.ts"),`import {readFile,writeFile} from 'node:fs/promises';
import {validateAction} from '@/lib/tasks/validation';
import {MEETING_CATEGORIES,accountClock} from '@/lib/tasks/model';
const file=process.cwd()+'/fixture.json';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function read(){return JSON.parse(await readFile(file,'utf8'));}
export async function GET(){const data=await read();if(data.delay)await new Promise(r=>setTimeout(r,data.delay));
  if(data.failRead)return json({message:'Local fixture: load unavailable.'},503);
  const now=new Date().toISOString(),today=accountClock(new Date(),'Asia/Kolkata').date;
  for(const pending of data.pendingRepeats||[]){if(pending.generated||pending.cancelled||pending.date>today)continue;
    const parent=data.tasks.find((task:{id:string})=>task.id===pending.source);
    data.tasks.push({...pending.task,created_at:now,updated_at:now,available_at:new Date(pending.date+'T00:00:00+05:30').toISOString()});
    if(parent)parent.history_at=now;pending.generated=true;
  }
  await writeFile(file,JSON.stringify(data));
  return json({...data,tasks:data.tasks.filter((task:{deleted_at?:string})=>!task.deleted_at)});
}
export async function POST(req:Request){
  const data=await read(); const input=validateAction(await req.json()); if(!input)return json({message:'Invalid local fixture input.'},400);
  if(data.delay)await new Promise(r=>setTimeout(r,data.delay));
  if(data.failWrite)return json({message:'Local fixture: save unavailable. Your draft is kept.'},503);
  let reply:unknown={};
  if(input.action==='setup'){data.timezone=input.timezone;reply={timezone:data.timezone};}
  if(input.action==='bootstrap'){for(const name of MEETING_CATEGORIES)if(!data.categories.some((c:{name:string})=>c.name===name))data.categories.push({id:crypto.randomUUID(),name});reply={categories:data.categories};}
  if(input.action==='category'){let category=data.categories.find((c:{name:string})=>c.name.toLowerCase()===input.name.toLowerCase());if(!category){category={id:crypto.randomUUID(),name:input.name};data.categories.push(category);}reply={category};}
  if(input.action==='create'||input.action==='create_many'){const now=new Date().toISOString();const fields=input.action==='create_many'?input.fields:[input.fields];const tasks=fields.map(field=>({...field,id:crypto.randomUUID(),created_at:now,updated_at:now,completed_at:null,series_id:field.repeat_rule&&field.repeat_rule!=='off'?crypto.randomUUID():null,repeat_anchor_day:field.repeat_rule==='monthly'?Number(field.due_date?.slice(-2)):null,history_at:null}));data.tasks.push(...tasks);reply=input.action==='create_many'?{tasks}:{task:tasks[0]};}
  if(input.action==='update'||input.action==='status'||input.action==='delete'){
    const task=data.tasks.find((t:{id:string;deleted_at?:string})=>t.id===input.id&&!t.deleted_at);if(!task)return json({message:'Task unavailable.'},404);
    if(task.updated_at!==input.version)return json({message:'This task changed elsewhere. Review the saved version before saving your draft.',latest:task,categories:data.categories},409);
    const wasActive=task.status==='active'; Object.assign(task,input.action==='delete'?{deleted_at:new Date().toISOString()}:input.action==='status'?{status:input.status}:input.fields,{updated_at:new Date().toISOString()});task.completed_at=task.status==='completed'?(task.completed_at||task.updated_at):null;if(wasActive&&task.status==='completed'&&task.repeat_rule&&task.repeat_rule!=='off'&&!task.next_occurrence_id&&input.action!=='delete'){
      const today=accountClock(new Date(),'Asia/Kolkata').date;const cutoff=task.due_date>today?task.due_date:today;const next=new Date(cutoff+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
      if(task.repeat_rule==='weekly'){while(!task.weekdays.includes(next.getUTCDay()))next.setUTCDate(next.getUTCDate()+1);}
      if(task.repeat_rule==='monthly'){const original=new Date(task.due_date+'T12:00:00Z');next.setUTCFullYear(original.getUTCFullYear(),original.getUTCMonth()+1,1);const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();next.setUTCDate(Math.min(task.repeat_anchor_day,last));while(next.toISOString().slice(0,10)<=cutoff){next.setUTCMonth(next.getUTCMonth()+1,1);const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();next.setUTCDate(Math.min(task.repeat_anchor_day,last));}}
      const date=next.toISOString().slice(0,10),nextId=crypto.randomUUID();
      data.pendingRepeats=[...(data.pendingRepeats||[]),{source:task.id,date,task:{...task,id:nextId,status:'active',completed_at:null,due_date:date,history_at:null,next_occurrence_id:null}}];
      task.next_occurrence_id=nextId;task.history_at=null;
    }
    reply=input.action==='delete'?{deleted:task.id}:{task};
  }
  data.writes=[...(data.writes||[]),{action:input.action,at:new Date().toISOString()}];
  await writeFile(file,JSON.stringify(data));
  if((input.action==='create'||input.action==='create_many')&&data.ambiguousCreate)return json({message:'Saving could not be confirmed. Refresh to review saved data.'},503);
  return json(reply);
}`);
console.log(`Isolated UI fixture: http://127.0.0.1:3014/account\nFixture state: ${path.join(dir,"fixture.json")}`);
const child=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port","3014"],{cwd:dir,stdio:"inherit",env:{...process.env,NEXT_TELEMETRY_DISABLED:"1"}});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>{process.exitCode=code??0;});
