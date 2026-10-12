import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Dataset, TaskAction, TaskRow } from "./model";
import { decodeCategory, decodeRow } from "./validation";

const TASK_COLUMNS = "id,title,notes,status,due_date,due_time,priority,category_id,created_at,updated_at,completed_at";
export class TaskError extends Error {
  constructor(public status: number, message: string, public latest?: TaskRow, public categories?: Category[]) { super(message); }
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if (["PGRST301","PGRST302","42501"].includes(error.code ?? "")) throw new TaskError(401,"Your session is unavailable. Sign in again to continue.");
  if (["23514","23503","23502","22007"].includes(error.code ?? "")) throw new TaskError(400,"Check the task details and category, then try again.");
  throw new TaskError(503,"We couldn’t confirm this request. Refresh to check saved data before trying again.");
}
export class TaskRepository {
  constructor(private client: SupabaseClient, private owner: string) {}
  async timezone(): Promise<Dataset["timezone"]> {
    const {data,error} = await this.client.from("account_settings").select("timezone").eq("owner_id",this.owner).maybeSingle();
    check(error);
    if (!data) return null;
    if (data.timezone !== "Asia/Kolkata") throw new TaskError(503,"This account’s timezone is not supported by this version.");
    return data.timezone;
  }
  private async pages<T extends {id:string}>(table: "tasks" | "categories", decode: (v:unknown)=>T): Promise<T[]> {
    const result: T[] = []; const seen = new Set<string>(); let cursor = "";
    for (let page=0; page<200; page++) {
      let query = this.client.from(table).select(table === "tasks" ? TASK_COLUMNS : "id,name")
        .eq("owner_id",this.owner).order("id",{ascending:true}).limit(500);
      if (cursor) query = query.gt("id",cursor);
      const {data,error} = await query; check(error);
      if (!Array.isArray(data)) throw new TaskError(503,"Saved data could not be loaded completely. Try refreshing.");
      const rows = data.map(decode);
      for (const row of rows) {
        if (seen.has(row.id) || (cursor && row.id <= cursor)) throw new TaskError(503,"Saved data changed during loading. Refresh again.");
        seen.add(row.id); result.push(row);
      }
      if (rows.length < 500) return result;
      cursor = rows.at(-1)!.id;
    }
    throw new TaskError(503,"There are too many records to load in this version. No partial list is shown.");
  }
  async read(): Promise<Dataset> {
    const [timezone,tasks,categories] = await Promise.all([this.timezone(),this.pages("tasks",decodeRow),this.pages("categories",decodeCategory)]);
    return {timezone,tasks,categories};
  }
  private async category(name: string): Promise<Category> {
    // Re-read names instead of an UPDATE-based upsert; category UPDATE is forbidden.
    const existing = (await this.pages("categories",decodeCategory)).find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const {data,error} = await this.client.from("categories").insert({name}).select("id,name").single();
    if (error?.code === "23505") {
      const match = (await this.pages("categories",decodeCategory)).find(c => c.name.toLowerCase() === name.toLowerCase());
      if (match) return match;
    }
    check(error); return decodeCategory(data);
  }
  async mutate(input: TaskAction): Promise<Record<string,unknown>> {
    if (input.action === "setup") {
      const existing = await this.timezone();
      if (existing) return {timezone:existing};
      const {data,error} = await this.client.from("account_settings").insert({timezone:input.timezone}).select("timezone").single();
      if (error?.code === "23505") {
        const timezone = await this.timezone(); if (timezone) return {timezone};
      }
      check(error);
      if (data?.timezone !== input.timezone) throw new TaskError(503,"We couldn’t confirm your account setup. Refresh before retrying.");
      return {timezone:data.timezone};
    }
    if (!await this.timezone()) throw new TaskError(409,"Confirm your account timezone before saving tasks.");
    if (input.action === "bootstrap") {
      for (const name of ["Personal","Work","Shopping"]) await this.category(name);
      return {categories:await this.pages("categories",decodeCategory)};
    }
    if (input.action === "category") return {category:await this.category(input.name)};
    if (input.action === "create") {
      const {data,error} = await this.client.from("tasks").insert(input.fields).select(TASK_COLUMNS).single();
      check(error); return {task:decodeRow(data)};
    }
    const values = input.action === "status" ? {status:input.status} : input.fields;
    const {data,error} = await this.client.from("tasks").update(values).eq("id",input.id)
      .eq("owner_id",this.owner).eq("updated_at",input.version).select(TASK_COLUMNS).maybeSingle();
    check(error);
    if (data) return {task:decodeRow(data)};
    const current = await this.client.from("tasks").select(TASK_COLUMNS).eq("id",input.id).eq("owner_id",this.owner).maybeSingle();
    check(current.error);
    if (!current.data) throw new TaskError(404,"This task is no longer available. Your draft has been kept.");
    throw new TaskError(409,"This task changed elsewhere. Review the saved version before saving your draft.",decodeRow(current.data),await this.pages("categories",decodeCategory));
  }
}
