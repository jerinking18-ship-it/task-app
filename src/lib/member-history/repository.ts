import type { SupabaseClient } from "@supabase/supabase-js";
import { TaskError } from "@/lib/tasks/repository";
import { decodeMemberHistory } from "./model";
export class MemberHistoryRepository {
  constructor(private client:SupabaseClient){}
  async read(){
    const {data,error}=await this.client.rpc("task_app_member_history");
    if(error){if(["42501","PGRST301","PGRST302"].includes(error.code??""))throw new TaskError(401,"Your session has ended. Sign in again to continue.");throw new TaskError(503,"Member history could not be loaded. Refresh to try again.");}
    try{return decodeMemberHistory(data);}catch{throw new TaskError(503,"Member history could not be loaded completely. Refresh to try again.");}
  }
}
