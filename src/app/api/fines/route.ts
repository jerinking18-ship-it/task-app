import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { MemberError, readMembers } from "@/lib/members/server";
import { TaskError } from "@/lib/tasks/repository";
import { FinesRepository } from "@/lib/fines/repository";
import { fineAction } from "@/lib/fines/model";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
async function repository() {
  const client=await createClient();const identity=await verifiedIdentity(client.auth);
  if(!identity)throw new TaskError(401,"Your session has ended. Sign in again to continue.");
  let state;
  try {state=await readMembers(client);if(!state.current || !state.workspace || !["owner","coordinator"].includes(state.current.role??""))throw new TaskError(403,"Only the Owner and Coordinators can view and manage fines."); }
  catch(error){if(error instanceof MemberError && error.status===401){try{await client.auth.signOut({scope:"local"});}catch{/* Fail closed. */}}throw error;}
  return new FinesRepository(client);
}
function failure(error:unknown){return error instanceof TaskError || error instanceof MemberError ? json({message:error.message},error.status)
  : json({message:"We couldn’t confirm this fine request. Refresh before trying again."},503);}
export async function GET(){try{return json(await (await repository()).read());}catch(error){return failure(error);}}
export async function POST(request:Request){
  try {
    if(request.headers.get("origin")!==authOrigin())return json({message:"Please use the Task App address to save changes."},403);
    if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return json({message:"Invalid fine request."},415);
    const reader=request.body?.getReader();if(!reader)return json({message:"Missing fine request."},400);
    const chunks:Uint8Array[]=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>8192){await reader.cancel();return json({message:"Template request is too large."},413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return json({message:"Invalid fine request."},400);}
    const input=fineAction(value);if(!input)return json({message:"Confirm the action and enter a reason when cancelling a fine."},400);
    return json(await (await repository()).mutate(input));
  }catch(error){return failure(error);}
}
