"use client";
import {useState,type ReactNode} from "react";
import type {SundayService} from "@/lib/tasks/model";
import {currentSundayService,sundayServiceOrder} from "@/lib/tasks/sunday-service";
import {SundayServiceIcon,sundayServiceName} from "./sunday-service-label";
import heading from "./assigned-meeting-heading.module.css";
import styles from "./sunday-service.module.css";
export default function SundayServiceSections({now,services,render}:{now:Date;services?:SundayService[];render:(service:SundayService,status:string,choose:(status:string)=>void)=>ReactNode}) {
  const [statuses,setStatuses]=useState({morning:"Active",evening:"Active"});
  return <div>{sundayServiceOrder(now).filter(service=>!services||services.includes(service)).map(service=><section key={service} className={styles.section} aria-label={sundayServiceName(service)}><div className={heading.card}><span className={heading.calendar}><SundayServiceIcon value={service}/></span><div className={heading.details}><p>{currentSundayService(now)===service?"CURRENT SERVICE":"SUNDAY SERVICE"}</p><h2>{sundayServiceName(service)}</h2></div></div>{render(service,statuses[service],status=>setStatuses(current=>({...current,[service]:status})))}</section>)}</div>;
}
