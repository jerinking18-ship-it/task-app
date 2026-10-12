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
await writeFile(path.join(dir,"src/app/sign-in/page.tsx"),`export default function Page(){return <main>Local fixture signed out. No credentials requested.</main>}`);
await writeFile(path.join(dir,"src/app/auth/submit/route.ts"),`export async function POST(){return Response.json({redirectTo:'/sign-in'})}`);
await writeFile(path.join(dir,"fixture.json"),JSON.stringify({tasks:[],categories:[],timezone:null,failRead:false,failWrite:false,ambiguousCreate:false,delay:0}));
await writeFile(path.join(dir,"src/app/api/tasks/route.ts"),`import {readFile,writeFile} from 'node:fs/promises';
import {validateAction} from '@/lib/tasks/validation';
import {MEETING_CATEGORIES} from '@/lib/tasks/model';
const file=process.cwd()+'/fixture.json';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function read(){return JSON.parse(await readFile(file,'utf8'));}
export async function GET(){const data=await read();if(data.delay)await new Promise(r=>setTimeout(r,data.delay));return data.failRead ? json({message:'Local fixture: load unavailable.'},503) : json({...data,tasks:data.tasks.filter((task:{deleted_at?:string})=>!task.deleted_at)});}
export async function POST(req:Request){
  const data=await read(); const input=validateAction(await req.json()); if(!input)return json({message:'Invalid local fixture input.'},400);
  if(data.delay)await new Promise(r=>setTimeout(r,data.delay));
  if(data.failWrite)return json({message:'Local fixture: save unavailable. Your draft is kept.'},503);
  let reply:unknown={};
  if(input.action==='setup'){data.timezone=input.timezone;reply={timezone:data.timezone};}
  if(input.action==='bootstrap'){for(const name of MEETING_CATEGORIES)if(!data.categories.some((c:{name:string})=>c.name===name))data.categories.push({id:crypto.randomUUID(),name});reply={categories:data.categories};}
  if(input.action==='category'){let category=data.categories.find((c:{name:string})=>c.name.toLowerCase()===input.name.toLowerCase());if(!category){category={id:crypto.randomUUID(),name:input.name};data.categories.push(category);}reply={category};}
  if(input.action==='create'||input.action==='create_many'){const now=new Date().toISOString();const fields=input.action==='create_many'?input.fields:[input.fields];const tasks=fields.map(field=>({...field,id:crypto.randomUUID(),created_at:now,updated_at:now,completed_at:null}));data.tasks.push(...tasks);reply=input.action==='create_many'?{tasks}:{task:tasks[0]};}
  if(input.action==='update'||input.action==='status'||input.action==='delete'){
    const task=data.tasks.find((t:{id:string;deleted_at?:string})=>t.id===input.id&&!t.deleted_at);if(!task)return json({message:'Task unavailable.'},404);
    if(task.updated_at!==input.version)return json({message:'This task changed elsewhere. Review the saved version before saving your draft.',latest:task,categories:data.categories},409);
    Object.assign(task,input.action==='delete'?{deleted_at:new Date().toISOString()}:input.action==='status'?{status:input.status}:input.fields,{updated_at:new Date().toISOString()});task.completed_at=task.status==='completed'?(task.completed_at||task.updated_at):null;reply=input.action==='delete'?{deleted:task.id}:{task};
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
