// Credential-free local Bin UI fixture. All writes affect only fixture.json.
import {cp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=path.join(root,'.local-ui-fixture');
await rm(dir,{recursive:true,force:true});
await mkdir(path.join(dir,'src/app/account'),{recursive:true});
for(const name of ['tasks','bin','members'])await mkdir(path.join(dir,'src/app/api',name),{recursive:true});
await mkdir(path.join(dir,'src/app/auth/submit'),{recursive:true});
await cp(path.join(root,'src/components'),path.join(dir,'src/components'),{recursive:true});
await cp(path.join(root,'src/lib'),path.join(dir,'src/lib'),{recursive:true});
for(const name of ['package.json','tsconfig.json','src/app/globals.css'])await cp(path.join(root,name),path.join(dir,name));
await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
await writeFile(path.join(dir,'next.config.ts'),(await readFile(path.join(root,'next.config.ts'),'utf8')).replace('root: process.cwd()',`root: ${JSON.stringify(root)}`).replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = { devIndicators: false,'));
await writeFile(path.join(dir,'src/app/layout.tsx'),`import './globals.css';export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}`);
const member={id:'00000000-0000-4000-8000-000000000091',name:'Example',createdAt:'2026-10-13T07:25:00Z',lastSeenAt:new Date().toISOString()};
await writeFile(path.join(dir,'src/app/account/page.tsx'),`import TaskApp from '@/components/task-app';export default function Page(){return <TaskApp saved today="2026-10-13" initialMembers={${JSON.stringify({current:member,members:[member]})}} accountEmail="example@example.test"/>}`);
await writeFile(path.join(dir,'src/app/api/members/route.ts'),`export async function GET(){return Response.json(${JSON.stringify({current:member,members:[member]})});}`);
await writeFile(path.join(dir,'src/app/auth/submit/route.ts'),`export async function POST(){return Response.json({redirectTo:'/account'});}`);
const categoryNames=['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting',"Woman's Meeting"];
const categories=categoryNames.map((name,index)=>({id:`00000000-0000-4000-8000-${String(100+index).padStart(12,'0')}`,name}));
const stamp=new Date().toISOString();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const base={notes:'Review the team and meeting details',status:'active',due_date:today,due_time:'12:55:00',priority:'medium',weekdays:[],repeat_rule:'off',series_id:null,history_at:null,available_at:null,repeat_anchor_day:null,created_at:stamp,updated_at:stamp,completed_at:null,completed_by_member_id:null,completed_by_name:null,deleted_at:null,deleted_by_name:null};
const tasks=['Prepare Sunday service','Confirm meeting venue','Arrange meeting seating','Check sound equipment','Prepare meeting notes','Reserve chairs'].map((title,index)=>({...base,id:`00000000-0000-4000-8000-${String(200+index).padStart(12,'0')}`,title,category_id:categories[index%5].id,...(index===3?{status:'completed',completed_at:stamp,completed_by_member_id:member.id,completed_by_name:member.name}:{}),...(index>=4?{deleted_at:index===4?stamp:new Date(Date.now()-86400000).toISOString(),deleted_by_name:'Example'}:{})}));
await writeFile(path.join(dir,'fixture.json'),JSON.stringify({tasks,categories,timezone:'Asia/Kolkata',failRead:false,failWrite:false,writes:[]}));
const shared=`import {readFile,writeFile} from 'node:fs/promises';const file=process.cwd()+'/fixture.json';const read=async()=>JSON.parse(await readFile(file,'utf8'));const save=async(data:unknown)=>writeFile(file,JSON.stringify(data));const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});`;
await writeFile(path.join(dir,'src/app/api/tasks/route.ts'),shared+`
import {validateAction} from '@/lib/tasks/validation';
export async function GET(){const data=await read();return data.failRead?json({message:'Local fixture load unavailable'},503):json({...data,tasks:data.tasks.filter((t:{deleted_at:string|null})=>!t.deleted_at)});}
export async function POST(request:Request){const data=await read();const input=validateAction(await request.json());if(!input)return json({message:'Invalid fixture input'},400);if(data.failWrite)return json({message:'Local fixture write unavailable'},503);let result:unknown={};const stamp=new Date().toISOString();
 if(input.action==='bootstrap')return json({categories:data.categories});
 if(input.action==='setup'){data.timezone=input.timezone;result={timezone:data.timezone};}
 if(input.action==='create'||input.action==='create_many'){const fields=input.action==='create'?[input.fields]:input.fields;const rows=fields.map(field=>({...field,id:crypto.randomUUID(),created_at:stamp,updated_at:stamp,completed_at:null,deleted_at:null,deleted_by_name:null}));data.tasks.push(...rows);result=input.action==='create'?{task:rows[0]}:{tasks:rows};}
 if(input.action==='delete'||input.action==='update'||input.action==='status'){const task=data.tasks.find((t:{id:string;deleted_at:string|null})=>t.id===input.id&&!t.deleted_at);if(!task)return json({message:'Task unavailable'},404);if(task.updated_at!==input.version)return json({message:'Task changed elsewhere',latest:task,categories:data.categories},409);if(input.action==='delete'){task.deleted_at=stamp;task.deleted_by_name='Example';result={deleted:task.id};}else{Object.assign(task,input.action==='update'?input.fields:{status:input.status});task.completed_at=task.status==='completed'?(task.completed_at||stamp):null;task.completed_by_member_id=task.status==='completed'?'00000000-0000-4000-8000-000000000091':null;task.completed_by_name=task.status==='completed'?'Example':null;result={task};}task.updated_at=stamp;}
 data.writes.push({action:input.action,at:stamp});await save(data);return json(result);}
`);
await writeFile(path.join(dir,'src/app/api/bin/route.ts'),shared+`
import {validateBinAction} from '@/lib/tasks/bin';
export async function GET(){const data=await read();return data.failRead?json({message:'Local fixture Bin unavailable'},503):json({tasks:data.tasks.filter((t:{deleted_at:string|null})=>!!t.deleted_at),categories:data.categories,templates:[]});}
export async function POST(request:Request){const data=await read();const input=validateBinAction(await request.json());if(!input)return json({message:'Invalid fixture Bin action'},400);if(data.failWrite)return json({message:'Local fixture Bin write unavailable'},503);
 if(!input.items.every(item=>data.tasks.some((t:{id:string;updated_at:string;deleted_at:string|null})=>t.id===item.id&&t.updated_at===item.version&&t.deleted_at)))return json({message:'A selected task changed. Refresh and select again. No tasks were changed.'},409);
 const ids=input.items.map(item=>item.id);if(input.action==='purge')data.tasks=data.tasks.filter((t:{id:string})=>!ids.includes(t.id));else for(const task of data.tasks)if(ids.includes(task.id)){task.deleted_at=null;task.deleted_by_name=null;task.history_at=null;task.updated_at=new Date().toISOString();}
 data.writes.push({action:input.action,ids,at:new Date().toISOString()});await save(data);return json({action:input.action,ids,items:input.items.map(item=>({kind:item.kind??"task",id:item.id}))});}
`);
console.log('Fictional Bin fixture: http://127.0.0.1:3020/account');
const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3020'],{cwd:dir,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code??0;});
