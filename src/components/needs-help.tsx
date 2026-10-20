"use client";
import NoMeeting from "./no-meeting";
import {activeSpecialMeeting} from "@/lib/special-meetings/model";

import { Symbol, dateLabel, type OverviewProps } from "./meeting-overview";
import { automaticOverviewCategory, overviewDeadline } from "@/lib/tasks/meeting-overview";
import { needsHelpMeeting } from "@/lib/tasks/needs-help";
import { canTakeTask, taskCoverage } from "@/lib/members/absence";
import { displayMemberName } from "@/lib/members/display-name";
import { accountClock, WEEKDAYS, type Task } from "@/lib/tasks/model";
import type { MemberState } from "@/lib/members/model";
import shared from "./meeting-overview.module.css";
import styles from "./needs-help.module.css";

type Props = OverviewProps & { memberState: MemberState | null; search: string; onTake: (task: Task) => void };

export default function NeedsHelp(props: Props) {
  const { tasks, now, coverageNow, currentMemberId, loaded, ready, timezone, loading, pending, error, deferred, onRefresh, onSetup, search } = props;
  const category = automaticOverviewCategory(now,props.specialMeetings);
  const special = needsHelpMeeting(tasks, "Special Meeting", currentMemberId, now, coverageNow, search);
  return <div className={`${shared.content} ${styles.content}`}>
    <div className={shared.intro}><span>{props.workspaceName}<i aria-hidden="true"/>India time · Mumbai</span><button className={shared.refresh} disabled={loading || pending} onClick={onRefresh} aria-label="Refresh needs help"><Symbol name="refresh"/><span>{loading ? "Refreshing…" : "Refresh"}</span></button></div>
    {deferred && <p className={shared.notice} role="status">Refresh queued. Finish saving to load updates.</p>}
    {error && <div className={shared.error} role="alert"><p>{error}</p>{loaded && <p>Showing the last loaded tasks. Refresh to check for updates.</p>}<button disabled={loading || pending} onClick={onRefresh}>Refresh saved data</button></div>}
    {!loaded ? <div className={shared.empty} role="status"><span className={shared.emptyIcon}><Symbol name="clock"/></span><h2>{error ? "Needs help unavailable" : "Loading tasks needing help…"}</h2><p>Your meeting tasks will appear here.</p></div> : !ready ? <div className={shared.empty}><span className={shared.emptyIcon}><Symbol name="calendar"/></span><h2>{timezone ? "Preparing your categories" : "A home for your time"}</h2><p>Use the existing India time and meeting category setup.</p><button disabled={pending} onClick={onSetup}>{timezone ? "Retry category setup" : "Use India time"}</button></div> : <>
      {category ? <HelpMeeting {...props} category={category}/> : <NoMeeting now={now} onAllTasks={props.onAllTasks}/>}
      {category!=="Special Meeting"&&special.released.length > 0 && <section className={shared.specialSection} aria-label="Special Meeting help"><HelpMeeting {...props} category="Special Meeting" special/></section>}
      <p className={shared.foot}>A little help makes the whole team stronger.</p>
    </>}
  </div>;
}

function HelpMeeting(props: Props & { category: string; special?: boolean }) {
  const { category, now, coverageNow, currentMemberId, search, special } = props;
  const rows = needsHelpMeeting(props.tasks, category, currentMemberId, now, coverageNow, search);
  const clock = accountClock(now, "Asia/Kolkata");
  const event=category==="Special Meeting"?activeSpecialMeeting(props.specialMeetings??[],now):null;
  const deadline = event?{resetAt:Date.parse(event.endsAt)}:overviewDeadline(category, now);
  return <section aria-label={`${category} tasks needing help`}>
    {special ? <div className={shared.specialHeading}><span className={shared.specialMark}><Symbol name="calendar"/></span><div><h2>Special Meeting</h2><p>Shown separately from your weekly meeting.</p></div></div> : <div className={styles.meeting}><div><p className={shared.eyebrow}>THIS WEEK’S MEETING</p><h2>{category==="Special Meeting"?props.specialMeetingTitle??category:category}</h2><p className={shared.meetingDate}>{dateLabel(clock.date,{weekday:"long",month:"long",day:"numeric"})}</p></div></div>}
    {(!special || rows.released.some(task=>task.assignedToId!==currentMemberId)) && <HelpSection {...props} title="Tasks needing help" rows={rows.others} own={false}/>}
    {(!special || rows.released.some(task=>task.assignedToId===currentMemberId)) && <HelpSection {...props} title="My tasks awaiting help" rows={rows.mine} own/>}
    <p className={shared.deadline}><Symbol name="clock"/><span>{deadline ? `Released tasks leave this view ${dateLabel(accountClock(new Date(deadline.resetAt-1),"Asia/Kolkata").date,{weekday:"long",month:"short",day:"numeric"})} at 11:59 PM India time.` : "Each Special Meeting release expires at 11:59 PM India time the day after its selected date."} Taken and completed tasks leave immediately. Saved records remain.</span></p>
  </section>;
}

function HelpSection({ title, rows, own, ...props }: Props & { title: string; rows: Task[]; own: boolean }) {
  const searching = !!props.search.trim();
  return <section className={own ? styles.mine : styles.others} aria-label={title}>
    <div className={shared.sectionHead} aria-live="polite"><h3>{title}</h3><span>{rows.length} {rows.length === 1 ? "task" : "tasks"}</span></div>
    {!own && rows.length > 0 && <p className={styles.sectionIntro}>Released by absent teammates.</p>}
    {rows.length ? <div className={styles.cards}>{rows.map(task => <HelpCard key={task.id} {...props} task={task} own={own}/>)}</div> : <div className={styles.empty}><span className={styles.emptyIcon}><Symbol name={searching ? "list" : "people"}/></span><div><h3>{searching ? "No tasks match your search" : own ? "None of your tasks are awaiting help" : "No tasks need help right now"}</h3><p>{searching ? "Try another task name or clear your search." : own ? "Tasks you release for this meeting will appear here until they are taken or completed." : "Tasks released by absent teammates will appear here while they still need help."}</p></div></div>}
  </section>;
}

function HelpCard({ task, own, members, memberState, coverageNow, now, pending, onTake }: Props & { task: Task; own: boolean }) {
  const coverage = taskCoverage(task, coverageNow);
  const name = displayMemberName(task.assignedToId, coverage?.memberName, members) || "A former member";
  const clock = accountClock(now, "Asia/Kolkata");
  const time = task.time ? new Intl.DateTimeFormat("en-US",{timeZone:"UTC",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(`2000-01-01T${task.time}:00Z`)) : "";
  return <article className={shared.taskCard} aria-label={task.title}>
    <div className={shared.taskHeading}><h4>{task.title}</h4><span className={`${shared.taskState} ${own ? shared.availableState : styles.helpMe}`}>{own ? <i aria-hidden="true"/> : <Symbol name="people"/>}{own ? "Available" : "Help me"}</span></div>
    <p className={shared.taskNotes}>{task.notes || "No notes added"}</p>
    <div className={shared.taskMetadata}>{task.priority !== "None" && <span className={shared.priority} data-priority={task.priority}>{task.priority}</span>}<span className={styles.due}>{task.date ? task.date === clock.date ? "Today" : dateLabel(task.date,{month:"short",day:"numeric"}) : "No due date"}{time && <><span aria-hidden="true">·</span><Symbol name="clock"/>{time}</>}</span>{(task.weekdays.length > 0 || task.repeat !== "Off") && <span className={shared.repeatMeta}>{task.weekdays.length > 0 && <span>{task.weekdays.map(day=>WEEKDAYS[day].slice(0,3)).join(" · ")}</span>}{task.repeat !== "Off" && <span className={shared.repeatIcon} title={`Repeats ${task.repeat.toLowerCase()}`} aria-label={`Repeats ${task.repeat.toLowerCase()}`}><Symbol name="repeat"/></span>}</span>}</div>
    <div className={shared.taskDetails}><div className={shared.taskAssignee}><span className={shared.avatar} aria-hidden="true">{Array.from(name)[0]?.toLocaleUpperCase()}</span><div><span className={shared.assigneeCaption}>{own ? "Assigned to me" : "Original assignee"}</span><strong>{name}{own && <small>You</small>}</strong></div></div>{own ? <span className={styles.waiting}>Waiting for a teammate<br/>to take this task</span> : canTakeTask(task,memberState,coverageNow) ? <button className={styles.take} disabled={pending} onClick={()=>onTake(task)} aria-label={`Take task: ${task.title}`}>Take task</button> : <span className={styles.waiting}>You’re unavailable<br/>for this meeting</span>}</div>
  </article>;
}
