"use client";

import styles from "./task-app.module.css";

const hours=Array.from({length:24},(_,hour)=>String(hour).padStart(2,"0"));
const minutes=Array.from({length:60},(_,minute)=>String(minute).padStart(2,"0"));

export default function TaskTime({value,onChange,label="Time"}:{value:string;onChange:(value:string)=>void;label?:string}) {
  const [hour="",minute=""]=value.split(":");
  return <div className={styles.timePicker} role="group" aria-label={label}>
    <select aria-label={`${label} hour`} value={hour} onChange={event=>onChange(`${event.target.value}:${minute||"00"}`)}>
      <option value="" disabled>HH</option>{hours.map(item=><option key={item}>{item}</option>)}
    </select>
    <span aria-hidden="true">:</span>
    <select aria-label={`${label} minute`} value={minute} onChange={event=>onChange(`${hour||"00"}:${event.target.value}`)}>
      <option value="" disabled>MM</option>{minutes.map(item=><option key={item}>{item}</option>)}
    </select>
    <button className={styles.timeClear} type="button" onClick={()=>onChange("")} disabled={!value} aria-label={`Clear ${label.toLowerCase()}`} title="Clear time">×</button>
  </div>;
}
