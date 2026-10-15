"use client";

import { useId, useState, type ReactNode } from "react";
import { accountClock, completionAge, isOverdue, WEEKDAYS, type Task } from "@/lib/tasks/model";
import { CATEGORY_COLORS } from "@/lib/member-history/model";
import { automaticOverviewCategory, meetingOverview, overviewTasks, overviewDeadline, type OverviewFilter } from "@/lib/tasks/meeting-overview";
import { assignmentLabel, isChangedCompletion, isChangedAssignment } from "@/lib/tasks/assignment";
import { displayMemberName } from "@/lib/members/display-name";
import { taskCoverage } from "@/lib/members/absence";
import type { Member } from "@/lib/members/model";
import styles from "./meeting-overview.module.css";

type SymbolName = "list" | "check" | "warning" | "people" | "arrow" | "clock" | "calendar" | "refresh" | "repeat";
export function Symbol({ name }: { name: SymbolName }) {
  const paths: Record<SymbolName, ReactNode> = {
    list: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></>,
    warning: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
    people: <><circle cx="9" cy="7" r="3"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a3 3 0 0 1 0 6M19 14a6 6 0 0 1 3 5v2"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/></>,
    refresh: <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>,
    repeat: <><path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4M7 21l-4-4 4-4M3 17h14a4 4 0 0 0 4-4"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", ...options }).format(new Date(`${day}T12:00:00+05:30`));

export type OverviewProps = {
  tasks: Task[]; members: Member[]; currentMemberId?: string; now: Date; coverageNow: Date; workspaceName: string;
  loaded: boolean; ready: boolean; timezone: string | null; loading: boolean; pending: boolean; error: string; deferred: boolean;
  onRefresh: () => void; onSetup: () => void;
};

export default function MeetingOverview(props: OverviewProps) {
  const { tasks, now, workspaceName, loaded, ready, timezone, loading, pending, error, deferred, onRefresh, onSetup } = props;
  const category = automaticOverviewCategory(now);
  const special = meetingOverview(tasks, "Special Meeting", now, props.coverageNow);
  return <div className={styles.content}>
    <div className={styles.intro}><span>{workspaceName}<i aria-hidden="true"/>India time · Mumbai</span><button className={styles.refresh} disabled={loading || pending} onClick={onRefresh} aria-label="Refresh meeting overview"><Symbol name="refresh"/><span>{loading ? "Refreshing…" : "Refresh"}</span></button></div>
    {deferred && <p className={styles.notice} role="status">Refresh queued. Finish saving to load updates.</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{loaded && <p>The overview shows the last loaded tasks. Refresh to check for updates.</p>}<button disabled={loading || pending} onClick={onRefresh}>Refresh saved data</button></div>}
    {!loaded ? <div className={styles.empty} role="status"><span className={styles.emptyIcon}><Symbol name="clock"/></span><h2>{error ? "Overview unavailable" : "Loading meeting overview…"}</h2><p>Your saved tasks will appear here.</p></div> : !ready ? <div className={styles.empty}><span className={styles.emptyIcon}><Symbol name="calendar"/></span><h2>{timezone ? "Preparing your categories" : "A home for your time"}</h2><p>Use the existing India time and meeting category setup to view your overview.</p><button disabled={pending} onClick={onSetup}>{timezone ? "Retry category setup" : "Use India time"}</button></div> : <>
      <p className={styles.overviewNotice}><Symbol name="list"/><span><strong>Read-only overview.</strong> Complete or reopen tasks from your task list.</span></p>
      <MeetingSection key={category} {...props} category={category}/>
      {special.tasks.length > 0 && <section className={styles.specialSection} aria-label="Special Meeting section"><div className={styles.specialHeading}><span className={styles.specialMark}><Symbol name="calendar"/></span><div><h2>Additional meeting</h2><p>Shown separately from your weekly meeting.</p></div></div><MeetingSection {...props} category="Special Meeting"/></section>}
      <p className={styles.foot}>Prepared together. Every task makes a difference.</p>
    </>}
  </div>;
}

function MeetingSection({ category, tasks, members, currentMemberId, now, coverageNow, pending }: OverviewProps & {category: string}) {
  const [filter, setFilter] = useState<OverviewFilter>("Remaining");
  const shownTasks = overviewTasks(tasks, category, filter, now, coverageNow);
  const detailHeading = filter === "Remaining" ? "Left to do" : filter === "Completed" ? "Completed tasks" : filter === "Needs help" ? "Tasks needing help" : "All task details";
  const summary = meetingOverview(tasks, category, now, coverageNow);
  const clock = accountClock(now, "Asia/Kolkata");
  const deadline = overviewDeadline(category, now);
  const resetDay = deadline ? accountClock(new Date(deadline.resetAt), "Asia/Kolkata").date : null;
  const disabled = pending;
  const detailsId = useId();
  const cards: { filter: OverviewFilter; title: string; value: number; icon: SymbolName; tone: string }[] = [
    { filter: "All", title: "All tasks", value: summary.tasks.length, icon: "list", tone: "" },
    { filter: "Completed", title: "Completed", value: summary.completed.length, icon: "check", tone: styles.done },
    { filter: "Remaining", title: "Left to do", value: summary.remaining.length, icon: "warning", tone: styles.left },
    { filter: "Needs help", title: "Needs help", value: summary.needsHelp.length, icon: "people", tone: styles.help },
  ];
  return <section className={styles.meetingSection} data-filter={filter} aria-label={`${category} overview`}>
      <section className={styles.meeting} aria-label={`${category} readiness`}>
        <div className={styles.meetingTop}><div><p className={styles.eyebrow}>YOUR MEETING AT A GLANCE</p><h2><i style={{background:CATEGORY_COLORS[category]}} aria-hidden="true"/>{category}</h2><p className={styles.meetingDate}>{deadline ? dateLabel(deadline.meetingDate, {weekday:"long",month:"long",day:"numeric"}) : "Selected meeting dates"}</p></div><div className={styles.readiness}><strong>{summary.percentage}<small>%</small></strong><span>complete</span></div></div>
        <div className={styles.progress} role="progressbar" aria-label="Tasks completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percentage} aria-valuetext={`${summary.completed.length} of ${summary.tasks.length} tasks completed`}><span style={{width:`${summary.percentage}%`}}/></div>
        <div className={styles.progressLabels}><span>{summary.completed.length} of {summary.tasks.length} tasks completed</span><strong>{summary.remaining.length} left to do!</strong></div>
        <div className={styles.stats}>{cards.map(card => <button key={card.filter} className={`${styles.stat} ${card.tone} ${filter === card.filter ? styles.selectedStat : ""}`} disabled={disabled} aria-pressed={filter === card.filter} aria-controls={detailsId} onClick={() => setFilter(card.filter)} aria-label={`View ${card.title.toLowerCase()}: ${card.value}`}><span className={styles.statLabel}><Symbol name={card.icon}/>{card.title}</span><strong>{card.value}</strong><span className={styles.arrow}><Symbol name="arrow"/></span>{filter === card.filter && <span className={styles.selectedLabel}>Selected</span>}</button>)}</div>
        <p className={styles.hint}>Select a count to view the details below.</p>
      </section>
      
      <div className={styles.lower}><section id={detailsId} aria-label="Meeting task details"><div className={styles.sectionHead} aria-live="polite"><h3>{detailHeading}</h3><span>{shownTasks.length} {shownTasks.length === 1 ? "task" : "tasks"}</span></div>
        {shownTasks.length ? <div className={styles.taskCards}>{shownTasks.map(task => {
          const coverage = taskCoverage(task, coverageNow);
          const assignedId = task.completed && task.claimOrigin && task.claimOrigin.takenById === task.assignedToId ? task.claimOrigin.memberId : coverage?.memberId ?? task.assignedToId;
          const own = assignedId === currentMemberId;
          const name = displayMemberName(assignedId, task.completed && task.claimOrigin && task.claimOrigin.takenById === task.assignedToId ? task.claimOrigin.memberName : coverage?.memberName, members) || (assignedId ? "A former member" : "Unassigned");
          const overdue = isOverdue(task, clock.date, clock.time);
          const status = task.completed ? "Completed" : coverage ? own ? "Available" : "Needs help" : overdue ? "Overdue!" : "Active";
          const time = task.time ? new Intl.DateTimeFormat("en-US", {timeZone:"UTC",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(`2000-01-01T${task.time}:00Z`)) : "";
          return <article key={task.id} className={`${styles.taskCard} ${coverage ? styles.helpTask : ""}`}>
            <div className={styles.taskHeading}><h4>{task.title}</h4><span className={styles.titleStatuses}>{isChangedAssignment(task) && <span className={styles.changed}>Switched to {displayMemberName(task.assignedToId,null,members)||"a former member"}</span>}<span className={`${styles.taskState} ${(coverage && !own) || overdue && !coverage ? styles.helpState : ""} ${coverage && own ? styles.availableState : ""}`}>{coverage ? <Symbol name="people"/> : overdue ? <Symbol name="warning"/> : <i aria-hidden="true"/>}{status}</span></span></div>
            <p className={styles.taskNotes}>{task.notes || "No notes added"}</p>
            {isChangedAssignment(task)&&task.claimOrigin&&<p className={styles.originalAssignee}>Original assignee: <strong>{displayMemberName(task.claimOrigin.memberId,task.claimOrigin.memberName,members)}</strong></p>}
            <p className={styles.taskContext}>{coverage ? own ? "Your task is available for a teammate." : "A teammate is needed for this task." : assignmentLabel(task,currentMemberId,members)}</p>
            <div className={styles.taskMetadata}>{task.priority !== "None" && <span className={styles.priority} data-priority={task.priority}>{task.priority} priority</span>}{(task.weekdays.length > 0 || task.repeat !== "Off") && <span className={styles.repeatMeta}>{task.weekdays.length > 0 && <span>{task.weekdays.map(day => WEEKDAYS[day].slice(0,3)).join(" · ")}</span>}{task.repeat !== "Off" && <span className={styles.repeatIcon} title={`Repeats ${task.repeat.toLowerCase()}`} aria-label={`Repeats ${task.repeat.toLowerCase()}`}><Symbol name="repeat"/></span>}</span>}{task.completed && isChangedCompletion(task) && <span className={styles.changed}>Switched to {displayMemberName(task.assignedToId,null,members)||"a former member"}</span>}</div>
            <div className={styles.taskDetails}><div className={styles.taskAssignee}><span className={styles.avatar} aria-hidden="true">{Array.from(name)[0]?.toLocaleUpperCase()}</span><div><span className={styles.assigneeCaption}>{coverage ? "Original assignee" : "Assigned to"}</span><strong>{name}{own && <small>You</small>}</strong></div></div><div className={styles.taskDue}><span>{task.completed ? completionAge(task.completedAt, now) || "Completed" : task.date ? task.date === clock.date ? "Today" : dateLabel(task.date,{month:"short",day:"numeric"}) : "No due date"}{!task.completed && time && <strong><Symbol name="clock"/>{time}</strong>}</span></div></div>
            {task.completed && <div className={styles.completionDetails}><span className={styles.completedBy}><Symbol name="people"/>Completed by <strong>{displayMemberName(task.completedById, task.completedByName, members) || "Not recorded"}</strong></span>{task.completedAt && Number.isFinite(Date.parse(task.completedAt)) && <time dateTime={task.completedAt}><Symbol name="clock"/>Completed on {new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Kolkata",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true,weekday:"short"}).format(new Date(task.completedAt))}</time>}</div>}
          </article>;
        })}</div> : <div className={styles.empty}><span className={styles.emptyIcon}><Symbol name={summary.tasks.length ? "check" : "calendar"}/></span><h3>{filter === "Completed" ? "No completed tasks yet" : filter === "Needs help" ? "No tasks need help" : summary.tasks.length ? "Everything is ready" : "No tasks in this meeting period"}</h3><p>{filter === "Completed" ? "Completed work in this category will appear here until its deadline." : filter === "Needs help" ? "Tasks released by absent teammates will appear here while help is needed." : summary.tasks.length ? "All visible tasks are completed." : "Tasks will appear here when they are added. Earlier completed and overdue tasks remain saved in their main pages."}</p></div>}
      </section><div>{summary.needsHelp.length > 0 && <section className={styles.attention}><div className={styles.attentionHeader}><span className={styles.attentionIcon}><Symbol name="people"/></span><h3>{summary.needsHelp.length === 1 ? "One task needs a teammate" : `${summary.needsHelp.length} tasks need a teammate`}</h3></div><p><strong>{summary.needsHelp.length} of the {summary.remaining.length} remaining tasks</strong> {summary.needsHelp.length === 1 ? "is" : "are"} available for a teammate to take.</p><button className={styles.helpLink} onClick={() => setFilter("Needs help")} disabled={disabled} aria-label="Show tasks needing help" aria-controls={detailsId}><span>View tasks needing help</span><Symbol name="arrow"/></button></section>}<p className={styles.deadline}><Symbol name="clock"/><span>{resetDay ? `Completed and overdue tasks leave this overview ${resetDay === clock.date ? "tonight" : dateLabel(resetDay,{weekday:"long",month:"short",day:"numeric"})} at 11:50 PM.` : "Each Special Meeting clears completed and overdue tasks at 11:50 PM the day after its selected date."} Active and future tasks stay visible. Saved data is kept.</span></p></div></div>
  </section>;
}
