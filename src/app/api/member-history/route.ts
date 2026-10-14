import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { AUTH_HEADERS } from "@/lib/auth/server";
import { readMembers, MemberError } from "@/lib/members/server";
import { TaskError } from "@/lib/tasks/repository";
import { MemberHistoryRepository } from "@/lib/member-history/repository";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
export async function GET(){
  try{
    const client=await createClient();if(!await verifiedIdentity(client.auth))throw new TaskError(401,"Your session has ended. Sign in again to continue.");
    try{if(!(await readMembers(client)).current)throw new TaskError(403,"Choose your name before viewing member history.");}
    catch(error){if(error instanceof MemberError&&error.status===401){try{await client.auth.signOut({scope:"local"});}catch{/* Fail closed. */}}throw error;}
    return json(await new MemberHistoryRepository(client).read());
  }catch(error){return error instanceof MemberError||error instanceof TaskError?json({message:error.message},error.status):json({message:"Member history could not be loaded. Refresh to try again."},503);}
}
