import type {SupabaseClient} from "@supabase/supabase-js";
import {TaskError} from "@/lib/tasks/repository";
import {decodeFines,type FineAction} from "./model";
function check(error:{code?:string}|null){if(!error)return;if(error.code==="P0403")throw new TaskError(403,"Only the Owner and Coordinators can view and manage fines.");if(error.code==="P0409")throw new TaskError(409,"This fine changed. Refresh and review it before trying again.");if(["42501","PGRST301","PGRST302"].includes(error.code??""))throw new TaskError(401,"Your session has ended. Sign in again.");if(error.code==="23514")throw new TaskError(400,"Confirm the action and enter a cancellation reason.");throw new TaskError(503,"We couldn’t confirm this fine request. Refresh before trying again.");}
export class FinesRepository{
 constructor(private client:SupabaseClient){}
 async read(){const{data,error}=await this.client.rpc("task_app_fines");check(error);try{return decodeFines(data);}catch{throw new TaskError(503,"Fines could not be loaded completely. Refresh to try again.");}}
 async mutate(action:FineAction){const{data,error}=await this.client.rpc("task_app_settle_fine",{fine_id:action.id,expected_version:action.version,operation:action.action,cancel_reason:action.reason,confirmed:true});check(error);if(data?.id!==action.id||data?.status!==action.action)throw new TaskError(503,"We couldn’t confirm this fine action. Refresh before trying again.");try{return {...data,data:decodeFines(data.data)};}catch{throw new TaskError(503,"We couldn’t confirm the updated fine list. Refresh before trying again.");}}
}
