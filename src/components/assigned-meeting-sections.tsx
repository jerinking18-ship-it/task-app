"use client";
import {useState,type ReactNode} from "react";
import type {AssignedTaskScope} from "@/lib/tasks/assignment";
import type {MeetingTitle} from "@/lib/meeting-title/model";
import AssignedMeetingHeading from "./assigned-meeting-heading";
import {SpecialMeetingHeading} from "./special-meeting-title";
import styles from "./sunday-service.module.css";

export default function AssignedMeetingSections({now,activeSpecial=false,title,hasSpecial,pending,error,onRefresh,render}:{
 activeSpecial?:boolean;now:Date;title:MeetingTitle|null;hasSpecial:boolean;pending:boolean;error:string;
 onRefresh:()=>void;render:(scope:AssignedTaskScope,status?:string,onStatus?:(value:string)=>void)=>ReactNode;
}){
 const[specialStatus,setSpecialStatus]=useState("Active");
 return <div>
  {!activeSpecial&&<section className={styles.section} aria-label="Regular assigned tasks">
   <AssignedMeetingHeading now={now}/>{render("regular")}
  </section>}
  {hasSpecial&&<section className={styles.section} aria-label="Special Meeting assigned tasks">
   <SpecialMeetingHeading value={title} editable={false} disabled={pending} error={error} onEdit={()=>{}} onRefresh={onRefresh}/>
   {render("special",specialStatus,setSpecialStatus)}
  </section>}
 </div>;
}
