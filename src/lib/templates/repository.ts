import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskError } from "@/lib/tasks/repository";
import { decodeTemplate, decodeTemplateRemoval, type TaskTemplate, type TemplateMutation } from "./model";
function check(error: {code?:string}|null) {
  if (!error) return;
  if (["42501","PGRST301","PGRST302"].includes(error.code??"")) throw new TaskError(401,"Your session has ended. Sign in again to continue.");
  if (error.code === "P0013") throw new TaskError(409,"This template changed elsewhere. Your draft is kept. Close and reopen it to review the latest version.");
  if (["23514","22P02","23502"].includes(error.code??"")) throw new TaskError(400,"Check the template name, titles and notes, then try again.");
  throw new TaskError(503,"We couldn’t confirm this template request. Your draft is kept. Refresh templates before trying again.");
}
export class TemplateRepository {
  constructor(private client: SupabaseClient, private owner: string) {}
  async read() {
    const templates:TaskTemplate[]=[]; let cursor="";
    for(let page=0;page<200;page++) {
      let query=this.client.from("task_templates").select("id,name,items,created_at,updated_at").eq("owner_id",this.owner).order("id",{ascending:true}).limit(100);
      if(cursor)query=query.gt("id",cursor);
      const {data,error}=await query;check(error);
      if(!Array.isArray(data))throw new TaskError(503,"Templates could not be loaded completely. Refresh to try again.");
      const rows=data.map(value=>decodeTemplate(value));
      for(const row of rows){if(row.id<=cursor)throw new TaskError(503,"Templates changed while loading. Refresh again.");cursor=row.id;templates.push(row);}
      if(rows.length<100)return {templates};
    }
    throw new TaskError(503,"There are too many templates to load completely. No partial list is shown.");
  }
  async mutate(input:TemplateMutation) {
    if(input.action==="remove"){
      const {data,error}=await this.client.rpc("task_app_remove_template",{template_id:input.id,expected_version:input.version,confirmed:input.confirmed});check(error);
      try{return {removed:decodeTemplateRemoval(data,input)};}catch{throw new TaskError(503,"Template removal could not be confirmed. Refresh before retrying.");}
    }
    const {data,error}=await this.client.rpc("task_app_save_template",{template_id:input.id,expected_version:input.version,template_name:input.name,template_items:input.items});
    check(error);
    const template=decodeTemplate(data);
    if(template.id!==input.id || template.name!==input.name || JSON.stringify(template.items)!==JSON.stringify(input.items))
      throw new TaskError(503,"The saved template could not be confirmed. Refresh templates before trying again.");
    return {template};
  }
}
