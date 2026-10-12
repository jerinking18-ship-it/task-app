"use client";

import { useId } from "react";
import { REPEATS, WEEKDAYS, type Repeat, type Task } from "@/lib/tasks/model";
import TaskDays from "./task-days";
import styles from "./task-app.module.css";

function RepeatIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4M7 21l-4-4 4-4M3 17h14a4 4 0 0 0 4-4" /></svg>;
}

export default function TaskRepeat({ task, onChange, onDaysChange, label = "Repeat" }: {
  task: Task; onChange: (value: Repeat) => void; onDaysChange: (days: number[]) => void; label?: string;
}) {
  const id = useId();
  const anchor = task.repeatAnchor && task.date ? task.repeatAnchor : Number(task.date.slice(-2));
  const days = WEEKDAYS.filter((_, day) => task.weekdays.includes(day));
  const schedule = task.repeat === "Weekly"
    ? days.length ? `Every ${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(days)}` : "Choose repeat days"
    : task.repeat === "Monthly" ? `Every month${anchor ? ` on day ${anchor}` : ""}` : "Every day";
  const date = task.date ? new Date(`${task.date}T12:00:00Z`) : null;
  const start = date && Number.isFinite(date.getTime())
    ? `Starts ${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date)}`
    : "Choose a starting due date";
  const time = task.time ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2000-01-01T${task.time}Z`)) : "";

  return <section className={styles.repeatSection}>
    <fieldset className={styles.repeatField}>
      <legend><RepeatIcon /><span>{label}</span></legend>
      <div className={styles.repeatChoices}>{REPEATS.map(rule => <label key={rule} className={styles.repeatChoice}>
        <input className={styles.srOnly} type="radio" name={`${id}-repeat`} value={rule} checked={task.repeat === rule} onChange={() => onChange(rule)} />
        <span className={styles.repeatButton}>{rule}{task.repeat === rule && <span className={styles.repeatCheck} aria-hidden="true">✓</span>}</span>
      </label>)}</div>
    </fieldset>
    <TaskDays compact required={task.repeat === "Weekly"} value={task.weekdays} onChange={onDaysChange} />
    {task.repeat !== "Off" && <div className={styles.repeatSummary}>
      <RepeatIcon />
      <div><strong>{schedule}</strong><p>{start} · {time ? `${time} IST` : "India time"}</p>
        <small>{task.repeat === "Monthly" ? "Shorter months use their last day. " : ""}After completion, the next task appears at midnight on its scheduled date (India time).</small>
      </div>
    </div>}
  </section>;
}
