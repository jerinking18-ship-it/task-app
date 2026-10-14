// Credential-free local Fines QA. All records and writes are fictional.
import './workspace-ui-fixture.mjs';
import {mkdir,readFile,writeFile}from'node:fs/promises';
import path from'node:path';
const dir=path.resolve('.local-ui-fixture/workspace-ui');
const file=path.join(dir,'fixture.json'),data=JSON.parse(await readFile(file,'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(91),stamp='2026-10-12T00:00:00Z';
const base={memberId:owner,memberName:'Jerin',category:'Sunday Service',amountPaise:5000,cutoffAt:'2026-10-11T23:30:00Z',assessedAt:stamp,version:stamp,status:'unpaid',settledAt:null,settledById:null,settledByName:null,reason:null};
data.fines={serverNow:new Date().toISOString(),enabledAt:'2026-10-01T00:00:00Z',members:[{id:owner,name:'Jerin'},{id:id(92),name:'Sarah'},{id:id(93),name:'Daniel'}],entries:['Arrange the seating','Check the microphones','Set up the camera','Prepare song sheets','Check the lighting','Welcome the visitors'].map((title,i)=>({...base,id:id(950+i),taskId:id(960+i),title,...(i>2?{status:i===5?'cancelled':'paid',settledAt:stamp,settledById:owner,settledByName:'Jerin',reason:i===5?'Meeting cancelled':null}:{})}))};
data.fineReads=0;await writeFile(file,JSON.stringify(data));
await mkdir(path.join(dir,'src/app/account/fines'),{recursive:true});
let page=await readFile(path.join(dir,'src/app/account/assigned-to-me/page.tsx'),'utf8');page=page.replace('initialView="Assigned to me"','initialView="Fines"');await writeFile(path.join(dir,'src/app/account/fines/page.tsx'),page);
const stateSource=page.slice(0,page.indexOf("import TaskApp"));
await mkdir(path.join(dir,'src/app/api/fines'),{recursive:true});
await writeFile(path.join(dir,'src/app/api/fines/route.ts'),stateSource+`
import fs from 'node:fs/promises';import path from 'node:path';import {fineAction}from '@/lib/fines/model';
const file=path.join(process.cwd(),'fixture.json');const read=async()=>JSON.parse(await fs.readFile(file,'utf8'));const save=async(d:unknown)=>fs.writeFile(file,JSON.stringify(d));
export async function GET(){const state=await stateForRequest();if(!['owner','coordinator'].includes(state.current.role))return Response.json({message:'Only the Owner and Coordinators can view and manage fines.'},{status:403});const data=await read();data.fineReads++;await save(data);if(data.fineFailRead)return Response.json({message:'Local fine read unavailable'},{status:503});return Response.json({...data.fines,serverNow:new Date().toISOString()});}
export async function POST(request:Request){const state=await stateForRequest();if(!['owner','coordinator'].includes(state.current.role))return Response.json({message:'Access restricted'},{status:403});const data=await read();const input=fineAction(await request.json());if(!input)return Response.json({message:'Invalid fine action'},{status:400});if(data.fineFailWrite)return Response.json({message:'Local fine write unavailable. Close and refresh before retrying.'},{status:503});const fine=data.fines.entries.find((f:any)=>f.id===input.id);if(!fine||fine.status!=='unpaid'||fine.version!==input.version)return Response.json({message:'Fine changed; close and refresh.'},{status:409});Object.assign(fine,{status:input.action,settledAt:new Date().toISOString(),version:new Date().toISOString(),settledById:state.current.id,settledByName:state.current.name,reason:input.reason});data.writes.push({action:'fine_'+input.action,id:fine.id,reason:input.reason});await save(data);return Response.json({id:fine.id,status:fine.status,data:{...data.fines,serverNow:new Date().toISOString()}});}
`);
console.log('Fictional Fines UI ready: use /fixture/owner then /account/fines.');
