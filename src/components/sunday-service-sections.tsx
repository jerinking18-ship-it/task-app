"use client";
import {useState,type ReactNode} from "react";
import type {SundayService} from "@/lib/tasks/model";
import type {SundayStatuses} from "@/lib/navigation/view-history";
import {currentSundayService} from "@/lib/tasks/sunday-service";
import {useSundaySelection} from "@/lib/tasks/use-sunday-selection";
import SundayServiceSelector from "./sunday-service-selector";
import {SundayServiceIcon,sundayServiceName} from "./sunday-service-label";
import heading from "./assigned-meeting-heading.module.css";
import styles from "./sunday-service.module.css";
export default function SundayServiceSections({now,services=["morning","evening"],statuses:controlled,onStatusChange,scope="category",showHeading=true,counts,disabled=false,render}:{now:Date;services?:SundayService[];statuses?:SundayStatuses;scope?:string;showHeading?:boolean;counts?:Partial<Record<SundayService,number>>;disabled?:boolean;onStatusChange?:(service:SundayService,status:string)=>void;render:(service:SundayService,status:string,choose:(status:string)=>void)=>ReactNode}) {
  const [local,setLocal]=useState<SundayStatuses>({morning:"Active",evening:"Active"});
  const statuses=controlled??local;
  const choose=onStatusChange??((service:SundayService,status:string)=>setLocal(current=>({...current,[service]:status})));
  const {service,selectService}=useSundaySelection(now,scope,services);
  if(!services.length)return null;
  return <section className={styles.section} aria-label={sundayServiceName(service)}>
    {showHeading&&<div className={heading.card}><span className={heading.calendar}><SundayServiceIcon value={service}/></span><div className={heading.details}><p>{currentSundayService(now)===service?"CURRENT SERVICE":"SUNDAY SERVICE"}</p><h2>{sundayServiceName(service)}</h2></div></div>}
    <SundayServiceSelector value={service} onChange={selectService} services={services} counts={counts} disabled={disabled}/>
    {render(service,statuses[service],status=>choose(service,status))}
  </section>;
}
