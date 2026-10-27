"use client";
import {useState,type ReactNode} from "react";
import type {AssignedTaskScope} from "@/lib/tasks/assignment";
import type {MeetingTitle} from "@/lib/meeting-title/model";
import type {SundayService} from "@/lib/tasks/model";
import type {SundayStatuses} from "@/lib/navigation/view-history";
import {currentSundayService} from "@/lib/tasks/sunday-service";
import AssignedMeetingHeading from "./assigned-meeting-heading";
import SundayServiceSections from "./sunday-service-sections";
import {SpecialMeetingHeading} from "./special-meeting-title";
import styles from "./sunday-service.module.css";

export default function AssignedMeetingSections({now,activeSpecial=false,title,hasSpecial,sundayServices=[],sundayStatuses,onSundayStatus,hasOtherRegular=false,pending,error,onRefresh,render}:{
 activeSpecial?:boolean;now:Date;title:MeetingTitle|null;hasSpecial:boolean;pending:boolean;error:string;
 sundayServices?:SundayService[];hasOtherRegular?:boolean;
 sundayStatuses?:SundayStatuses;onSundayStatus?:(service:SundayService,status:string)=>void;
 onRefresh:()=>void;render:(scope:AssignedTaskScope,status?:string,onStatus?:(value:string)=>void)=>ReactNode;
}){
 const[specialStatus,setSpecialStatus]=useState("Active");
 const splitSunday=currentSundayService(now)!==null&&sundayServices.length>0;
 return <div>
  {!activeSpecial&&<section className={styles.section} aria-label="Regular assigned tasks">
   <AssignedMeetingHeading now={now}/>{splitSunday?<>
    <SundayServiceSections now={now} services={sundayServices} statuses={sundayStatuses} onStatusChange={onSundayStatus} render={(service,status,choose)=>render(service,status,choose)}/>
    {hasOtherRegular&&render("other")}
   </>:render("regular")}
  </section>}
  {hasSpecial&&<section className={styles.section} aria-label="Special Meeting assigned tasks">
   <SpecialMeetingHeading value={title} editable={false} disabled={pending} error={error} onEdit={()=>{}} onRefresh={onRefresh}/>
   {render("special",specialStatus,setSpecialStatus)}
  </section>}
 </div>;
}
