"use client";
import {useEffect,useRef,useState} from "react";
import type {Task} from "@/lib/tasks/model";
import {specialDaysLabel,specialEndDay,type SpecialMeeting} from "@/lib/special-meetings/model";
import app from "./task-app.module.css";
import styles from "./special-meeting-schedule.module.css";
function Lock({open=false}:{open?:boolean}){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/>{open?<path d="M8 10V7a4 4 0 0 1 7-2"/>:<path d="M8 10V7a4 4 0 0 1 8 0v3"/>}</svg>;}
export function SpecialMeetingSchedule({task,onChange,startDate,label="Number of days"}:{task:Task;onChange:(days:number|null)=>void;startDate?:string;label?:string}){
 const start=startDate??task.specialMeeting?.startDate??task.date,days=task.specialDays??null;
 const validDays=days===null||Number.isInteger(days)&&days>=1&&days<=31;
 return <section className={styles.schedule} aria-label="Special Meeting schedule"><label className={app.field}>{label}<span className={app.optional}>optional</span><input type="number" min="1" max="31" step="1" value={days??""} readOnly={!!task.specialPlanId} onChange={e=>onChange(e.target.value===""?null:Number(e.target.value))} placeholder="Existing next-day deadline"/></label>
 {start&&validDays&&<><p className={styles.days}>{specialDaysLabel(start,days)}</p><p className={app.editorHint}>Ends {specialEndDay(start,days)} at 11:59 PM India time.</p></>}
 <p className={styles.repeat}>Daily · {days===null?"One meeting day, with the existing next-day deadline":`${days} meeting ${days===1?"day":"days"}`}. Only the current day's occurrence is shown.</p>
 {!task.id&&<div className={styles.locked}><Lock/><div><strong>Locked automatically</strong><p>Saved in Special Meeting. An Owner or Coordinator can activate it using the heading lock.</p></div></div>}
 </section>;
}
export function SpecialMeetingLock({meeting,title,allowed,disabled,pending,onChange,onOpenChange,onRefresh}:{meeting:SpecialMeeting|null;title:string;allowed:boolean;disabled:boolean;pending:boolean;onChange:(meeting:SpecialMeeting,locked:boolean)=>Promise<unknown>;onOpenChange:(open:boolean)=>void;onRefresh:()=>void}){
 const[review,setReview]=useState<SpecialMeeting|null>(null),[error,setError]=useState("");const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),saving=useRef(false);
 useEffect(()=>{onOpenChange(!!review);if(!review)return;dialog.current?.showModal();dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{dialog.current?.close();requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());};},[review,onOpenChange]);
 function close(){if(!saving.current){setReview(null);setError("");}}
 async function confirm(){if(!review||saving.current||disabled||!allowed)return;if(meeting?.id!==review.id||meeting.version!==review.version){setError("This meeting changed. Close and refresh before retrying.");return;}saving.current=true;setError("");try{await onChange(review,!review.locked);setReview(null);}catch(e){setError(e instanceof Error?e.message:"The meeting change could not be confirmed. Refresh before retrying.");}finally{saving.current=false;}}
 const label=meeting?.locked?"Unlock and activate meeting":"Lock meeting and restore normal views";
 return <><button ref={trigger} type="button" className={styles.headingLock} style={!allowed?{marginLeft:"auto"}:undefined} aria-label={allowed?label:meeting?.locked?"Meeting locked":"Meeting activated"} title={allowed?label:meeting?.locked?"Meeting locked":"Meeting activated"} disabled={disabled||!allowed||!meeting} onClick={()=>{if(meeting){setReview(meeting);setError("");}}}><Lock open={meeting?!meeting.locked:false}/></button>
 {review&&<dialog ref={dialog} className={`${app.dialog} ${app.confirmDialog}`} aria-label={review.locked?"Activate Special Meeting":"Lock Special Meeting"} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className={app.confirmContent}><p className={app.editorEyebrow}>SPECIAL MEETING</p><h2>{review.locked?`Activate ${title}?`:"Lock this meeting and restore normal views?"}</h2><p>{review.locked?"Only this Special Meeting’s tasks will appear during its scheduled dates. Regular tasks stay saved.":"Normal views return immediately. This meeting’s tasks and progress stay saved in its category."}</p><p><strong>{specialDaysLabel(review.startDate,review.days)}</strong><br/>Ends {specialEndDay(review.startDate,review.days)} at 11:59 PM India time.</p><p>No fines apply to Special Meeting. Saved history stays preserved.</p>{error&&<p role="alert" className={app.error}>{error}</p>}<div className={app.editorActions}><button type="button" className={app.cancelButton} disabled={pending} onClick={close}>Cancel</button><button type="button" className={`${app.saveButton} ${app.reassignConfirm}`} disabled={pending||disabled||!!error} onClick={()=>void confirm()}>{pending?"Saving…":review.locked?"Unlock & activate":"Lock meeting"}</button></div>{error&&<button type="button" className={app.cancelButton} onClick={()=>{close();onRefresh();}}>Close and refresh</button>}</div></dialog>}
 </>;
}

export function SpecialMeetingLockedLabel(){return <span className={styles.lockedLabel}><Lock/>Locked</span>;}

export function SpecialMeetingSelection({meetings,selected,now,disabled,onSelect}:{meetings:SpecialMeeting[];selected:SpecialMeeting|null;now:Date;disabled:boolean;onSelect:(id:string)=>void}){
 const available=meetings.filter(e=>Date.parse(e.endsAt)>now.getTime());
 if(!selected)return null;
 return <div className={styles.eventInfo}><Lock open={!selected.locked}/>{available.length>1?<label>Meeting schedule <select aria-label="Choose Special Meeting schedule" value={selected.id} disabled={disabled} onChange={e=>onSelect(e.target.value)}>{available.map(e=><option key={e.id} value={e.id}>{e.startDate} · {e.days??1} meeting {e.days===1||e.days===null?"day":"days"} · {e.locked?"Locked":"Activated"}</option>)}</select></label>:<span>{selected.locked?"Locked":"Activated"} · {specialDaysLabel(selected.startDate,selected.days)}</span>}</div>;
}
