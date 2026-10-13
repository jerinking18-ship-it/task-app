import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { MemberError } from "@/lib/members/server";
import { decodeMembers } from "@/lib/members/model";
import { presenceInput } from "@/lib/members/presence";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
export async function POST(request:Request) {
  try {
    if(request.headers.get("origin")!==authOrigin())return json({message:"Please use the Task App address to continue."},403);
    if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return json({message:"Invalid activity request."},415);
    const reader=request.body?.getReader();if(!reader)return json({message:"Missing activity request."},400);
    const chunks:Uint8Array[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return json({message:"Activity request is too large."},413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return json({message:"Invalid activity request."},400);}
    const input=presenceInput(value);if(!input)return json({message:"Invalid activity request."},400);
    const client=await createClient();if(!await verifiedIdentity(client.auth))return json({message:"Your session has ended. Sign in again to continue."},401);
    const {data,error}=await client.rpc("task_app_presence",{tab_id:input.tabId,is_active:input.active,client_sequence:input.sequence});
    if(error){if(["42501","PGRST301","PGRST302"].includes(error.code??""))throw new MemberError(401,"Your session has ended. Sign in again to continue.");throw new MemberError(503,"Activity could not be updated. Reconnecting automatically.");}
    return json(decodeMembers(data));
  }catch(error){return error instanceof MemberError?json({message:error.message},error.status):json({message:"Activity could not be updated. Reconnecting automatically."},503);}
}
