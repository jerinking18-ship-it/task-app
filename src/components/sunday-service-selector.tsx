"use client";
import type {SundayService} from "@/lib/tasks/model";
import {SUNDAY_SERVICES} from "@/lib/tasks/sunday-selection";
import styles from "./sunday-service-selector.module.css";

export default function SundayServiceSelector({value,onChange,services=SUNDAY_SERVICES,counts,disabled=false,spaced=false}:{value:SundayService;onChange:(service:SundayService)=>void;services?:SundayService[];counts?:Partial<Record<SundayService,number>>;disabled?:boolean;spaced?:boolean}){
 return <div className={`${styles.tabs}${spaced?` ${styles.spaced}`:""}`} role="group" aria-label="Choose Sunday service">{services.map(service=><button type="button" key={service} className={value===service?styles.selected:""} aria-pressed={value===service} disabled={disabled} onClick={()=>onChange(service)}>
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{service==="morning"?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M3 18h18M5 14a7 7 0 0 1 14 0M12 3v3M3 7l2 2m14 0 2-2M8 21h8"/>}</svg>
  {service==="morning"?"Morning Service":"Evening Service"}{counts?.[service]!==undefined&&<span>{counts[service]}</span>}
 </button>)}</div>;
}
