import { NextResponse } from "next/server";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { decodeMembers } from "@/lib/members/model";
import { MemberError, workspaceRequest } from "@/lib/members/server";
import {isRecord,timestamp,uuid} from "@/lib/tasks/validation";
import { workspaceAction, workspaceRpc } from "@/lib/workspace/model";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
export async function POST(request:Request){
 try{
  if(request.headers.get("origin")!==authOrigin())return json({message:"Please use the app address to continue."},403);
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return json({message:"Invalid workspace request."},415);
  const reader=request.body?.getReader();if(!reader)return json({message:"Missing workspace request."},400);
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json({message:"Workspace request is too large."},413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return json({message:"Invalid workspace request."},400);}
  const action=workspaceAction(value);if(!action)return json({message:"Check the workspace details and confirmation."},400);
  const client=await createClient();if(!await verifiedIdentity(client.auth))return json({message:"Sign in with your verified personal email to continue."},401);
  const rpc=workspaceRpc(action);const data=await workspaceRequest(client,rpc.name,rpc.args);
  if(action.action==="invite"){
   if(!isRecord(data)||typeof data.token!=="string"||!/^[a-f0-9]{64}$/.test(data.token)||!uuid(data.id)||!timestamp(data.expires_at))throw new MemberError(503,"Invitation could not be confirmed. Refresh before creating a new link.");
   return json({...data,invitationUrl:`${authOrigin()}/invite#${data.token}`});
  }
  return json(decodeMembers(data));
 }catch(error){return error instanceof MemberError?json({message:error.message},error.status):json({message:"We couldn’t confirm this workspace request. Refresh before retrying."},503);}
}
