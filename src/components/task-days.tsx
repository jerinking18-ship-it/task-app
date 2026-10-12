"use client";

import { WEEKDAYS } from "@/lib/tasks/model";
import styles from "./task-app.module.css";

export default function TaskDays({value,onChange,required=false,compact=false}:{value:number[];onChange:(days:number[])=>void;required?:boolean;compact?:boolean}) {
  return <fieldset className={styles.daysField}>
    <legend>{required?"Repeat on":"Days"} <span className={required?styles.required:styles.optional}>{required?"*":"optional"}</span></legend>
    <div className={styles.dayButtons}>{WEEKDAYS.map((day,index)=><button
      key={day} type="button" aria-label={day} aria-pressed={value.includes(index)}
      className={value.includes(index) ? styles.daySelected : ""}
      onClick={()=>onChange(value.includes(index) ? value.filter(item=>item!==index) : [...value,index].sort((a,b)=>a-b))}
    >{compact?day.slice(0,3):day}{compact && value.includes(index) && <span className={styles.dayCheck} aria-hidden="true">✓</span>}</button>)}</div>
  </fieldset>;
}
