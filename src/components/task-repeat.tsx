"use client";
import { REPEATS, type Repeat, type Task } from "@/lib/tasks/model";
import styles from "./task-app.module.css";

export default function TaskRepeat({task,onChange,label="Repeat"}:{task:Task;onChange:(value:Repeat)=>void;label?:string}) {
  const anchor=task.repeatAnchor && task.date ? task.repeatAnchor : Number(task.date.slice(-2));
  return <div>
    <label className={styles.property}><span>{label}</span><select value={task.repeat} onChange={event=>onChange(event.target.value as Repeat)}>{REPEATS.map(rule=><option key={rule}>{rule}</option>)}</select></label>
    {task.repeat!=="Off" && <p className={styles.editorHint}>{task.repeat==="Weekly" ? "Repeats on every selected weekday. Start on one of those days." : task.repeat==="Monthly" ? `Repeats monthly${anchor ? ` on day ${anchor}` : ""}. Shorter months use their last day.` : "Repeats every day."} Completing this task creates the next future occurrence. India time.</p>}
  </div>;
}
