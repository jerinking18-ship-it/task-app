"use client";

import { WEEKDAYS } from "@/lib/tasks/model";
import styles from "./task-app.module.css";

export default function TaskDays({value,onChange}:{value:number[];onChange:(days:number[])=>void}) {
  return <fieldset className={styles.daysField}>
    <legend>Days <span className={styles.optional}>optional</span></legend>
    <div className={styles.dayButtons}>{WEEKDAYS.map((day,index)=><button
      key={day} type="button" aria-pressed={value.includes(index)}
      className={value.includes(index) ? styles.daySelected : ""}
      onClick={()=>onChange(value.includes(index) ? value.filter(item=>item!==index) : [...value,index].sort((a,b)=>a-b))}
    >{day}</button>)}</div>
  </fieldset>;
}
