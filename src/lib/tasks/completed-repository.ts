import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCompletedPurge, decodeCompletedSnapshot, type CompletedPurge } from "./completed";
import { TaskError } from "./repository";
function check(error: { code?: string } | null) {
  if (!error) return;
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "")) throw new TaskError(401, "Your session has ended. Sign in again to continue.");
  if (error.code === "P0013") throw new TaskError(409, "Completed tasks changed since you opened this confirmation. Close and review again. Nothing was deleted.");
  throw new TaskError(503, "Deletion could not be confirmed. Close and refresh before trying again.");
}
export class CompletedRepository {
  constructor(private client: SupabaseClient) {}
  async read() {
    const { data, error } = await this.client.rpc("task_app_completed", { operation: "preview" });
    check(error);
    try { return decodeCompletedSnapshot(data); } catch { throw new TaskError(503, "The completed task count could not be confirmed. Close and refresh before trying again."); }
  }
  async purge(input: CompletedPurge) {
    const { data, error } = await this.client.rpc("task_app_completed", {
      operation: "purge", expected_count: input.count, expected_snapshot: input.snapshot, confirmed: input.confirmed,
    });
    check(error);
    try { return { deleted: decodeCompletedPurge(data, input), snapshot: input.snapshot }; }
    catch { throw new TaskError(503, "Deletion could not be confirmed. Close and refresh before trying again."); }
  }
}
