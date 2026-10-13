import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeMembers, type MemberChoice } from "./model";

export class MemberError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function failure(error: { code?: string } | null) {
  if (!error) return;
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "")) throw new MemberError(401, "Your session has ended. Sign in again to continue.");
  if (error.code === "23505") throw new MemberError(409, "That name is already listed. Enter a different name, or choose your existing profile when signing in.");
  if (error.code === "P0011") throw new MemberError(409, "Your name changed on another device. Refresh your profile before editing again.");
  if (error.code === "P0010") throw new MemberError(409, "This account has reached its 10-member limit. Choose an existing member to continue.");
  if (error.code === "23514") throw new MemberError(400, "Enter a name between 1 and 50 characters.");
  throw new MemberError(503, "We couldn’t load account members. Please try again.");
}
export async function readMembers(client: SupabaseClient) {
  const { data, error } = await client.rpc("task_app_member_state");
  failure(error);
  return decodeMembers(data);
}
export async function chooseMember(client: SupabaseClient, action: MemberChoice) {
  const { data, error } = await client.rpc("task_app_choose_member", {
    member_id: action.action === "select" ? action.id : null,
    member_name: action.action === "create" ? action.name : null,
  });
  failure(error);
  const state = decodeMembers(data);
  if (!state.current) throw new MemberError(503, "We couldn’t confirm your name. Please refresh before retrying.");
  return state;
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
