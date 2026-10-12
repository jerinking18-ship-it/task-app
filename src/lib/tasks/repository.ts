import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Dataset, TaskAction, TaskRow } from "./model";
import { MEETING_CATEGORIES } from "./model";
import { decodeCategory, decodeRow } from "./validation";

const TASK_COLUMNS = "id,title,notes,status,due_date,due_time,priority,category_id,weekdays,repeat_rule,series_id,history_at,available_at,repeat_anchor_day,created_at,updated_at,completed_at";
export class TaskError extends Error {
  constructor(public status: number, message: string, public latest?: TaskRow, public categories?: Category[], public future?:TaskRow[]) { super(message); }
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
      if (table === "tasks") query = query.is("deleted_at",null);
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
    // Owner-scoped, server-clock catch-up also covers a delayed Cron run. Before
    // midnight this is a no-op. Failed maintenance must never show a partial list.
    const {error}=await this.client.rpc("task_app_release_my_repeats"); check(error);
    const [timezone,tasks,categories] = await Promise.all([this.timezone(),this.pages("tasks",decodeRow),this.pages("categories",decodeCategory)]);
    const versions=new Map<string,string>();
    for(const task of tasks) if(task.series_id && (!versions.has(task.series_id) || task.updated_at>versions.get(task.series_id)!)) versions.set(task.series_id,task.updated_at);
    return {timezone,tasks:tasks.map(task=>({...task,series_version:task.series_id?versions.get(task.series_id):task.updated_at})),categories};
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
      for (const name of MEETING_CATEGORIES) await this.category(name);
      return {categories:await this.pages("categories",decodeCategory)};
    }
    if (input.action === "category") return {category:await this.category(input.name)};
    if (input.action === "create") {
      const {data,error} = await this.client.from("tasks").insert(input.fields).select(TASK_COLUMNS).single();
      check(error); return {task:decodeRow(data)};
    }
    if (input.action === "create_many") {
      // A single INSERT statement is atomic under PostgreSQL/RLS, including all category joins.
      const {data,error} = await this.client.from("tasks").insert(input.fields).select(TASK_COLUMNS);
      check(error);
      if (!Array.isArray(data) || data.length !== input.fields.length) throw new TaskError(503,"We couldn’t confirm all tasks. Refresh and review saved data before trying again.");
      return {tasks:data.map(decodeRow)};
    }
    const {data,error} = await this.client.rpc("task_app_mutate",{
      task_id:input.id,expected_version:input.version,operation:input.action,
      fields:input.action==="update"?input.fields:null,new_status:input.action==="status"?input.status:null,
      edit_scope:input.action==="update"?(input.scope??"this"):"this",
      expected_series_version:input.action==="update"?(input.seriesVersion??input.version):null
    });
    check(error);
    if (data && !data.conflict) return input.action === "delete" ? {deleted:decodeRow(data).id} : {task:decodeRow(data)};
    const current = await this.client.from("tasks").select(TASK_COLUMNS).eq("id",input.id).eq("owner_id",this.owner).is("deleted_at",null).maybeSingle();
    check(current.error);
    if (!current.data) throw new TaskError(404,"This task is no longer available. Your draft has been kept.");
    throw new TaskError(409,input.action === "delete" ? "This task changed elsewhere. Review the saved version before deleting it." : "This task or a future occurrence changed elsewhere. Review saved tasks before saving your draft.",decodeRow({...current.data,...(data?.series_version?{series_version:data.series_version}:{})}),await this.pages("categories",decodeCategory),Array.isArray(data?.future)?data.future.map(decodeRow):undefined);
  }
}
