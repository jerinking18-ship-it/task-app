"use client";
import {useEffect,useState} from "react";
import type {SundayService} from "./model";
import {selectedSundayService,SUNDAY_SERVICES,sundaySelectionPeriod} from "./sunday-selection";

// Presentation metadata only; no tasks, identities or attendance are stored.
export function useSundaySelection(now:Date,scope:string,services:SundayService[]=SUNDAY_SERVICES){
 const period=sundaySelectionPeriod(now),key=`bgm-sunday-selection:${scope}`;
 const[manual,setManual]=useState<{period:string;key:string;service:SundayService}|null>(null);
 useEffect(()=>{
  try{
   const value=JSON.parse(window.sessionStorage.getItem(key)??"null");
   setManual(value&&value.period===period&&(value.service==="morning"||value.service==="evening")?{period,key,service:value.service}:null);
  }catch{setManual(null);}
 },[key,period]);
 const service=selectedSundayService(now,services,manual?.period===period&&manual.key===key?manual.service:null);
 function selectService(value:SundayService){
  if(!services.includes(value))return;
  const selected={period,service:value};setManual({...selected,key});
  try{window.sessionStorage.setItem(key,JSON.stringify(selected));}catch{/* Storage may be unavailable; selection still works. */}
 }
 return {service,selectService};
}
