"use client";
import NoMeeting from "../no-meeting";
import { automaticOverviewCategory } from "@/lib/tasks/meeting-overview";

import type {ReactNode} from "react";
import type { Member, MemberState } from "@/lib/members/model";
import { attendanceMeetings, meetingAttendance } from "@/lib/members/attendance";
import type { Task } from "@/lib/tasks/model";
import shared from "./users.module.css";
import styles from "./attendance-page.module.css";

function AttendanceIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9zM8 13l2 2 5-5"/></svg>;
}

export function AttendanceEntry({ onOpen, disabled,children }: { onOpen: () => void; disabled: boolean;children?:ReactNode }) {
  return <div className={styles.dock}><button type="button" className={styles.entry} disabled={disabled} onClick={onOpen}><AttendanceIcon/>Attendance</button>{children}</div>;
}

type Props = {
  state: MemberState | null; tasks: Task[]; tasksReady: boolean; tasksError: string;
  search: string; now: Date; loading: boolean; error: string; onRefresh: () => void; onBack: () => void;
};

export default function AttendancePanel({ state, tasks, tasksReady, tasksError, search, now, loading, error, onRefresh, onBack }: Props) {
  const meetings = attendanceMeetings(tasksReady ? tasks : [], now);
  const query = search.trim().toLocaleLowerCase();
  const ready = meetingAttendance(state, "", now).ready;
  return <section className={shared.panel} aria-label="Meeting attendance list" aria-busy={loading}>
    <button type="button" className={styles.back} onClick={onBack}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>Back to Users</button>
    {(error || tasksError) && <div className={styles.problem} role="alert"><p>{error || tasksError}</p>{ready && <p>Showing the last loaded attendance. Refresh to check for updates.</p>}<button type="button" disabled={loading} onClick={onRefresh}>Refresh attendance</button></div>}
    {!ready ? <div className={shared.empty} role="status"><AttendanceIcon/><h3>{loading ? "Loading attendance…" : "Attendance unavailable"}</h3><p>{loading ? "Getting the current meeting’s members ready." : "Refresh to load attendance before checking who is present."}</p>{!loading && <button type="button" className={shared.secondary} onClick={onRefresh}>Refresh attendance</button>}</div> : <>
      {!automaticOverviewCategory(now)&&<NoMeeting now={now}/>}
      {meetings.map(({ category, meetingDate,sundayService }) => {
        const groups = meetingAttendance(state, category, now, meetingDate,sundayService);
        const title=sundayService==="morning"?"Morning Service":sundayService==="evening"?"Evening Service":category;
        return <section className={styles.meetingSection} key={`${category}:${sundayService??meetingDate ?? "regular"}`} aria-label={`${title}${meetingDate ? ` ${meetingDate}` : ""} attendance`}>
          <div className={styles.meetingHeading}><span>{sundayService?"Sunday Service":category === "Special Meeting" ? "Special meeting" : "Current meeting"}</span><h2>{title}</h2>{meetingDate && <time dateTime={meetingDate}>{new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${meetingDate}T12:00:00+05:30`))}</time>}</div>
          <MemberGroup people={groups.absent} currentId={state?.current?.id} category={title} query={query}/>
          <MemberGroup present people={groups.present} currentId={state?.current?.id} category={title} query={query}/>
        </section>;
      })}
      <p className={styles.note}>Present members haven’t marked absent for this meeting.</p>
    </>}
  </section>;
}

function MemberGroup({ people, currentId, category, query, present = false }: { people: Member[]; currentId?: string; category: string; query: string; present?: boolean }) {
  const visible = people.filter(member => member.name.toLocaleLowerCase().includes(query));
  const title = present ? "Present members" : "Absent members";
  return <section className={shared.absentCard} aria-label={title}>
    <div className={shared.absentHeading}><h2>{title}</h2><span className={present ? styles.presentCount : undefined} aria-live="polite">{visible.length}</span></div>
    {visible.length ? <ul>{visible.map(member => <li key={member.id}><span className={`${shared.absentAvatar} ${present ? styles.presentAvatar : ""}`} aria-hidden="true">{Array.from(member.name)[0]?.toLocaleUpperCase()}</span><div><strong>{member.name}{member.id === currentId && <small className={shared.you}>You</small>}</strong><p>{category}</p></div><span className={`${shared.absentLabel} ${present ? styles.presentLabel : ""}`}>{present ? "Present" : "Absent"}</span></li>)}</ul> : <div className={`${shared.empty} ${styles.groupEmpty}`}><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></svg><h3>{query ? "No members found" : `No ${present ? "present" : "absent"} members`}</h3><p>{query ? "Try another name." : present ? "Everyone is marked absent for this meeting." : "No one is marked absent for this meeting."}</p></div>}
  </section>;
}
