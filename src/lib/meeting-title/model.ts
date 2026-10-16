import {isRecord,timestamp} from "@/lib/tasks/validation";
export type MeetingTitle = {title:string|null;version:string|null};
export const DEFAULT_MEETING_TITLE="Special Meeting";
export function meetingName(value:MeetingTitle|null|undefined){return value?.title??DEFAULT_MEETING_TITLE;}
export function titleInput(value:unknown):string|null {
  if(typeof value!=="string" || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))return null;
  const title=value.trim();return title.length<=60?title:null;
}
export function titleAction(value:unknown):{title:string;version:string|null}|null {
  if(!isRecord(value)||Object.keys(value).some(k=>!["title","version"].includes(k)))return null;
  const title=titleInput(value.title);
  return title!==null&&(value.version===null||timestamp(value.version))?{title,version:value.version}:null;
}
export function decodeMeetingTitle(value:unknown):MeetingTitle {
  if(!isRecord(value)||!(value.version===null||timestamp(value.version))
    || !(value.title===null||typeof value.title==="string"&&!!value.title&&titleInput(value.title)===value.title)
    || value.title!==null&&value.version===null)throw new Error("Meeting title could not be confirmed. Refresh before retrying.");
  return {title:value.title as string|null,version:value.version as string|null};
}
export class MeetingTitleError extends Error {
  constructor(message:string,public status=0,public latest?:MeetingTitle){super(message);}
}
