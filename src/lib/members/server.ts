import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeMembers } from "./model";

export class MemberError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function failure(error: { code?: string } | null) {
  if (!error) return;
  if(error.code==="P0403")throw new MemberError(403,"Your current role or verified email does not allow this action.");
  if(error.code==="P0409")throw new MemberError(409,"This invitation or membership changed. Refresh and try again.");
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "")) throw new MemberError(401, "Your session has ended. Sign in again to continue.");
  if (error.code === "23505") throw new MemberError(409, "That name or membership is already listed. Choose a different name.");
  if (error.code === "P0011") throw new MemberError(409, "Your name changed on another device. Refresh your profile before editing again.");
  if (error.code === "P0012") throw new MemberError(409, "Attendance changes are available only on the meeting day, from 12:00 AM to 9:00 PM India time.");
  if (error.code === "P0010") throw new MemberError(409, "All 10 workspace places are in use or reserved. Cancel a pending invitation or wait for it to expire.");
  if (error.code === "23514") throw new MemberError(400, "Check the name, category or meeting date and confirmation.");
  throw new MemberError(503, "We couldn’t load account members. Please try again.");
}
export async function readMembers(client: SupabaseClient) {
  const { data, error } = await client.rpc("task_app_member_state");
  failure(error);
  return decodeMembers(data);
}
export async function renameMember(client: SupabaseClient, name: string, previousName: string) {
  const { data, error } = await client.rpc("task_app_rename_member", { member_name: name, previous_name: previousName });
  failure(error);
  const state = decodeMembers(data);
  if (!state.current) throw new MemberError(503, "Refresh your profile to confirm your saved name.");
  return state;
}
export async function leaveMember(client: SupabaseClient) {
  const { data, error } = await client.rpc("task_app_leave_member");
  failure(error);
  if (data !== true) throw new MemberError(503, "We couldn’t confirm that your profile left. Refresh before trying again.");
}

export async function workspaceRequest(client:SupabaseClient,rpc:string,args:Record<string,unknown>){
 const {data,error}=await client.rpc(rpc,args);failure(error);return data;
}
