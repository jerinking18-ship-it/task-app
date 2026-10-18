import type { SupabaseClient } from "@supabase/supabase-js";
import { MemberError } from "@/lib/members/server";
import { decodeCheckIn, type CheckInAction } from "./model";
export async function readCheckIn(client: SupabaseClient, details = false) {
  const { data, error } = await client.rpc("task_app_check_in_state", { details });
  checkInFailure(error); return decodeCheckIn(data, details);
}
export function checkInFailure(error: { code?: string } | null) {
  if (!error) return;
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "")) throw new MemberError(401, "Sign in again to continue.");
  if (error.code === "P0403") throw new MemberError(403, "Check-in details are available only to Owners and Coordinators in this workspace.");
  if (["P0016", "P0409", "23514"].includes(error.code ?? "")) throw new MemberError(409, "Check-in is closed or this meeting changed. Refresh to see its current hours.");
  throw new MemberError(503, "Check-in couldn’t be confirmed. Refresh before trying again.");
}
export async function saveCheckIn(client: SupabaseClient, input: CheckInAction) {
  const { data, error } = await client.rpc("task_app_check_in", { selected_category: input.categoryId, selected_date: input.meetingDate, selected_service: input.service, selected_meeting: input.meetingId, confirmed: true });
  checkInFailure(error); return data;
}
