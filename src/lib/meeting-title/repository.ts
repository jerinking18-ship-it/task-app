import type {SupabaseClient} from "@supabase/supabase-js";
import {isRecord} from "@/lib/tasks/validation";
import {decodeMeetingTitle,MeetingTitleError,type MeetingTitle} from "./model";
function check(error:{code?:string}|null){
  if(!error)return;
  if(error.code==="P0403")throw new MeetingTitleError("Only Owners and Coordinators can change the meeting title.",403);
  if(["42501","PGRST301","PGRST302"].includes(error.code??""))throw new MeetingTitleError("Sign in again to view the meeting title.",401);
  if(error.code==="23514")throw new MeetingTitleError("Use a single-line meeting title of up to 60 characters.",400);
  throw new MeetingTitleError("The meeting title could not be confirmed. Refresh before retrying.",503);
}
export class MeetingTitleRepository {
  constructor(private client:SupabaseClient){}
  async read(){const{data,error}=await this.client.rpc("task_app_special_meeting_title");check(error);return decodeMeetingTitle(data);}
  async save(title:string,version:string|null):Promise<MeetingTitle>{
    const{data,error}=await this.client.rpc("task_app_set_special_meeting_title",{meeting_title:title,expected_version:version});check(error);
    if(isRecord(data)&&data.conflict===true)throw new MeetingTitleError("The meeting title changed elsewhere. Review the saved title before saving.",409,decodeMeetingTitle(data.latest));
    const saved=decodeMeetingTitle(data);
    if(saved.title!==(title||null)||!saved.version)throw new MeetingTitleError("Saving the meeting title could not be confirmed. Refresh before retrying.",503);
    return saved;
  }
}
