import {NextResponse}from'next/server';
import {createClient}from'@/lib/supabase/server';
import {verifiedIdentity}from'@/lib/auth/flow';
import {AUTH_HEADERS}from'@/lib/auth/server';
import {MemberError,readMembers}from'@/lib/members/server';
import {TaskError}from'@/lib/tasks/repository';
import {ActivityRepository}from'@/lib/activity/repository';
import {activityQuery}from'@/lib/activity/model';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:AUTH_HEADERS});
export async function GET(request:Request){try{
 const query=activityQuery(new URL(request.url).searchParams);if(!query)return json({message:'Choose valid activity filters.'},400);
 const client=await createClient();if(!await verifiedIdentity(client.auth))return json({message:'Sign in again to view activity.'},401);
 const state=await readMembers(client);if(!state.current||!state.workspace||!['owner','coordinator'].includes(state.current.role??''))return json({message:'Activity is available to Owners and Coordinators only.'},403);
 return json(await new ActivityRepository(client).read(query.filter,query.before,query.beforeId));
}catch(error){return error instanceof TaskError||error instanceof MemberError?json({message:error.message},error.status):json({message:'Activity is unavailable. Refresh to try again.'},503);}}
