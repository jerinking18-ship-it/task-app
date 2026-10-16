import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifiedIdentity} from "@/lib/auth/flow";
import {authOrigin,AUTH_HEADERS} from "@/lib/auth/server";
import {titleAction,MeetingTitleError} from "@/lib/meeting-title/model";
import {MeetingTitleRepository} from "@/lib/meeting-title/repository";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
async function repository(){const client=await createClient();if(!await verifiedIdentity(client.auth))throw new MeetingTitleError("Sign in to view the meeting title.",401);return new MeetingTitleRepository(client);}
function failure(error:unknown){return error instanceof MeetingTitleError?json({message:error.message,latest:error.latest},error.status):json({message:"The meeting title could not be loaded. Refresh to try again."},503);}
export async function GET(){try{return json(await(await repository()).read());}catch(error){return failure(error);}}
export async function POST(request:Request){
  try{
    if(request.headers.get("origin")!==authOrigin())return json({message:"Please use the app address to save changes."},403);
    if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return json({message:"Invalid title request."},415);
    const reader=request.body?.getReader();if(!reader)return json({message:"Missing title request."},400);
    const chunks:Uint8Array[]=[];let length=0;
    for(;;){const{done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json({message:"Title request is too large."},413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return json({message:"Invalid title request."},400);}
    const action=titleAction(value);if(!action)return json({message:"Use a single-line meeting title of up to 60 characters."},400);
    return json(await(await repository()).save(action.title,action.version));
  }catch(error){return failure(error);}
}
