"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { decodeMemberResponse, type MemberState } from "@/lib/members/model";
import { activeAbsences } from "@/lib/members/absence";
import { date } from "@/lib/tasks/validation";
import { automaticOverviewCategory } from "@/lib/tasks/meeting-overview";
import type { Category } from "@/lib/tasks/model";
import { requestWorkspace } from "@/lib/workspace/client";
import styles from "./attendance.module.css";

type Props = {
 state:MemberState;categories:Category[];now:Date;disabled:boolean;onSaved:(state:MemberState)=>void;
 onPending:(pending:boolean)=>void;onRefresh:()=>void;
};
type Review = { categoryId:string;category:string;meetingDate:string|null;absenceId:string|null;expiresAt:string|null };

function MeetingAttendance({state,category,now,disabled,onSaved,onPending,onRefresh,special=false}:Omit<Props,"categories">&{category:Category|undefined;special?:boolean}){
 const [meetingDate,setMeetingDate]=useState("");
 const [reviewed,setReviewed]=useState<Review|null>(null);
 const [pending,setPending]=useState(false);const [problem,setProblem]=useState("");
 const busy=useRef(false);const modal=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLButtonElement>(null);
 const absent=activeAbsences(state,now).find(a=>a.memberId===state.current?.id&&a.categoryId===category?.id);
 const ready=state.absences!==undefined&&!!category;
 const returning=!!reviewed?.absenceId;
 useEffect(()=>{
  if(!reviewed)return;const dialog=modal.current;dialog?.showModal();dialog?.querySelector<HTMLButtonElement>("button")?.focus();
  return()=>{dialog?.close();requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());};
 },[reviewed]);
 function close(){if(!busy.current){setReviewed(null);setProblem("");}}
 function review(event:FormEvent){
  event.preventDefault();if(disabled||pending||!ready||!category)return;setProblem("");
  if(special&&!absent&&!date(meetingDate)){setProblem("Choose a valid meeting date.");return;}
  setReviewed({categoryId:category.id,category:category.name,meetingDate:special?absent?.meetingDate??meetingDate:null,absenceId:absent?.id??null,expiresAt:absent?.expiresAt??null});
 }
 async function submit(){
  if(busy.current||disabled||!ready||!state.current||!reviewed)return;
  if(category?.id!==reviewed.categoryId||reviewed.absenceId!== (absent?.id??null)
   ||reviewed.expiresAt!==(absent?.expiresAt??null)){
   setProblem("Your meeting or attendance changed. Close and refresh your profile before retrying.");return;
  }
  busy.current=true;setPending(true);onPending(true);setProblem("");
  try{
   const next=decodeMemberResponse(await requestWorkspace(reviewed.absenceId&&reviewed.expiresAt
    ?{action:"unmarkAbsent",id:reviewed.absenceId,expiresAt:reviewed.expiresAt,confirmed:true}
    :{action:"absent",categoryId:reviewed.categoryId,meetingDate:reviewed.meetingDate,confirmed:true}));
   if(next.current?.id!==state.current.id||next.absences===undefined)throw new Error("Your attendance could not be confirmed. Refresh your profile before retrying.");
   const active=activeAbsences(next,new Date(next.serverNow??now));
   if(reviewed.absenceId?active.some(a=>a.id===reviewed.absenceId)
    :!active.some(a=>a.memberId===state.current!.id&&a.categoryId===reviewed.categoryId&&a.meetingDate===reviewed.meetingDate)){
    throw new Error("Your attendance could not be confirmed. Refresh your profile before retrying.");
   }
   onSaved(next);setReviewed(null);
  }catch(reason){setProblem(reason instanceof Error?reason.message:"Your attendance could not be confirmed. Refresh before retrying.");}
  finally{busy.current=false;setPending(false);onPending(false);}
 }
 const dialogId=special?"special-attendance-title":"meeting-attendance-title";
 return <form className={styles.meetingForm} onSubmit={review} aria-label={special?"Special Meeting attendance":"Current meeting attendance"} aria-busy={pending}>
  <div className={styles.meetingHeading}>
   <div className={styles.meetingTopline}><span className={styles.meetingKicker}>{special?"Special meeting":"Current meeting"}</span>
    <span className={`${styles.attendanceStatus} ${absent?styles.isAbsent:styles.notAbsent}`} role="status"><span aria-hidden="true"/>{!ready?"Unavailable":absent?"Absent":"Not absent"}</span></div>
   <h3>{category?.name??(special?"Special Meeting":"Meeting unavailable")}</h3>
  </div>
  {special&&<label>Meeting date<input type="date" required min="0001-01-01" max="9999-12-30" value={absent?.meetingDate??meetingDate} disabled={disabled||pending||!!absent} onChange={e=>{setMeetingDate(e.target.value);setProblem("");}}/></label>}
  <button ref={trigger} className={`${styles.absentButton} ${absent?styles.unmarkButton:""}`} disabled={disabled||pending||!ready}>
   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{absent?<><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></>:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 10l5 5m0-5-5 5"/></>}</svg>
   {pending?"Saving…":absent?"Unmark absent":"Mark myself absent"}
  </button>
  {absent&&<p className={styles.status}>You’re marked absent for {category?.name}.</p>}
  {!ready&&<p role="status">Attendance is unavailable. Refresh your profile to check again.</p>}
  {!reviewed&&problem&&<p className={styles.error} role="alert">{problem}</p>}
  {reviewed&&<dialog ref={modal} className={styles.dialog} aria-labelledby={dialogId} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <h2 id={dialogId}>{returning?"Unmark absence?":"Mark yourself absent?"}</h2>
   {returning?<><p>You’ll be available for <strong>{reviewed.category}</strong> again.</p><p>Your unclaimed tasks return to your control. Tasks already taken by a teammate stay with them.</p><p>Only this meeting’s absence will be removed.</p></>:<><p>Your unfinished tasks for <strong>{reviewed.category}</strong>{reviewed.category==="Special Meeting"&&reviewed.meetingDate?<> on <strong>{new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeZone:"Asia/Kolkata"}).format(new Date(reviewed.meetingDate+"T12:00:00+05:30"))}</strong></>:null} will become available for teammates to take.</p><p>Later assignments and repeat schedules stay unchanged. Absence clears automatically after this meeting period.</p></>}
   {problem&&<p className={styles.error} role="alert">{problem}</p>}
   <div className={styles.actions}><button type="button" className={styles.cancel} disabled={pending} onClick={close}>{returning?"Keep absent":"Cancel"}</button><button type="button" className={`${styles.absentButton} ${returning?styles.unmarkButton:""}`} disabled={pending||!!problem} onClick={()=>void submit()}>{pending?"Saving…":returning?"Unmark absent":"Mark myself absent"}</button></div>
   {problem&&<button type="button" className={styles.refresh} disabled={pending} onClick={()=>{close();onRefresh();}}>Close and refresh profile</button>}
  </dialog>}
 </form>;
}
export default function AttendanceCard(props:Props){
 const regular=props.categories.find(category=>category.name===automaticOverviewCategory(props.now));
 const special=props.categories.find(category=>category.name==="Special Meeting");
 return <section className={styles.card} aria-label="Meeting attendance">
  <h2>Meeting attendance</h2><p>Can’t attend a meeting? Make your unfinished tasks available for someone to help.</p>
  <MeetingAttendance {...props} category={regular}/>
  {special&&<MeetingAttendance {...props} category={special} special/>}
 </section>;
}
