"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { decodeMemberResponse, type MemberState } from "@/lib/members/model";
import { activeAbsences } from "@/lib/members/absence";
import { date } from "@/lib/tasks/validation";
import type { Category } from "@/lib/tasks/model";
import { MEETING_CATEGORIES } from "@/lib/tasks/model";
import { requestWorkspace } from "@/lib/workspace/client";
import styles from "./attendance.module.css";

export default function AttendanceCard({state,categories,now,disabled,onSaved,onPending,onRefresh}:{
 state:MemberState;categories:Category[];now:Date;disabled:boolean;onSaved:(state:MemberState)=>void;
 onPending:(pending:boolean)=>void;onRefresh:()=>void;
}){
 const options=categories.filter(c=>MEETING_CATEGORIES.includes(c.name));
 const [categoryId,setCategoryId]=useState("");const selected=options.find(c=>c.id===categoryId)??options[0];
 const [meetingDate,setMeetingDate]=useState("");const [confirm,setConfirm]=useState(false);const [pending,setPending]=useState(false);const [problem,setProblem]=useState("");
 const busy=useRef(false);const modal=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLButtonElement>(null);
 const absent=activeAbsences(state,now).find(a=>a.memberId===state.current?.id&&a.categoryId===selected?.id);
 const ready=state.absences!==undefined&&!!selected;
 useEffect(()=>{if(!confirm)return;const dialog=modal.current;dialog?.showModal();dialog?.querySelector<HTMLButtonElement>("button")?.focus();return()=>{dialog?.close();requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());};},[confirm]);
 function close(){if(!busy.current){setConfirm(false);setProblem("");}}
 function review(event:FormEvent){event.preventDefault();if(disabled||pending||!ready||absent)return;setProblem("");if(selected.name==="Special Meeting"&&!date(meetingDate)){setProblem("Choose a valid meeting date.");return;}setConfirm(true);}
 async function submit(){
  if(busy.current||disabled||!ready||absent||!state.current||(selected.name==="Special Meeting"&&!date(meetingDate)))return;
  busy.current=true;setPending(true);onPending(true);setProblem("");
  try{
   const next=decodeMemberResponse(await requestWorkspace({action:"absent",categoryId:selected.id,meetingDate:selected.name==="Special Meeting"?meetingDate:null,confirmed:true}));
   if(next.current?.id!==state.current.id||!activeAbsences(next,new Date(next.serverNow??now)).some(a=>a.memberId===state.current!.id&&a.categoryId===selected.id))throw new Error("Your absence could not be confirmed. Refresh your profile before retrying.");
   onSaved(next);setConfirm(false);
  }catch(reason){setProblem(reason instanceof Error?reason.message:"Your absence could not be confirmed. Refresh before retrying.");}
  finally{busy.current=false;setPending(false);onPending(false);}
 }
 return <section className={styles.card} aria-label="Meeting attendance" aria-busy={pending}>
  <h2>Meeting attendance</h2><p>Can’t attend a meeting? Make your unfinished tasks available for someone to help.</p>
  <form onSubmit={review}>
   <label>Meeting category<select value={selected?.id??""} disabled={disabled||pending||!ready} onChange={e=>{setCategoryId(e.target.value);setMeetingDate("");setProblem("");}}>{!options.length&&<option value="">Loading categories…</option>}{options.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {selected?.name==="Special Meeting"&&<label>Meeting date<input type="date" required min="0001-01-01" max="9999-12-30" value={absent?.meetingDate??meetingDate} disabled={disabled||pending||!!absent} onChange={e=>setMeetingDate(e.target.value)}/></label>}
   <button ref={trigger} className={styles.absentButton} disabled={disabled||pending||!ready||!!absent}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 10l5 5m0-5-5 5"/></svg>{absent?"Marked absent":"Mark myself absent"}</button>
   {absent&&<p className={styles.status} role="status">You’re marked absent for {selected.name}. This clears automatically after the meeting period.</p>}
   {!ready&&<p role="status">Attendance is unavailable. Refresh your profile to check again.</p>}
  </form>
  {!confirm&&problem&&<p className={styles.error} role="alert">{problem}</p>}
  {confirm&&<dialog ref={modal} className={styles.dialog} aria-labelledby="absence-title" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
   <h2 id="absence-title">Mark yourself absent?</h2><p>Your unfinished tasks for <strong>{selected.name}</strong>{selected.name==="Special Meeting"&&meetingDate?<> on <strong>{new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeZone:"Asia/Kolkata"}).format(new Date(meetingDate+"T12:00:00+05:30"))}</strong></>:null} will become available for teammates to take.</p><p>Later assignments and repeat schedules stay unchanged. Absence clears automatically after this meeting period.</p>
   {problem&&<p className={styles.error} role="alert">{problem}</p>}
   <div className={styles.actions}><button type="button" className={styles.cancel} disabled={pending} onClick={close}>Cancel</button><button type="button" className={styles.absentButton} disabled={pending||!!problem||!!absent} onClick={()=>void submit()}>{pending?"Saving…":"Mark myself absent"}</button></div>
   {problem&&<button type="button" className={styles.refresh} disabled={pending} onClick={()=>{close();onRefresh();}}>Close and refresh profile</button>}
  </dialog>}
 </section>;
}
