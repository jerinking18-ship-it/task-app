"use client";
import { useState } from "react";
import { checkInOpen, contextKey, type CheckInContext } from "@/lib/check-in/model";
import type { useCheckIn } from "@/lib/check-in/use-check-in";
import { canManageTasks, type MemberState } from "@/lib/members/model";
import NoMeeting from "../no-meeting";
import heading from "../assigned-meeting-heading.module.css";
import users from "../members/users.module.css";
import styles from "./check-in.module.css";
type Store = ReturnType<typeof useCheckIn>;
type Props = { store: Store; members: MemberState | null; now: Date; title: string; details?: boolean; blocked: boolean; onList: () => void; onBack: () => void; onSaved: (state: MemberState) => void; onContinue: () => void; onPending: (pending: boolean) => void };
export function CheckIcon({ name, size = 20 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    evening: <path d="M3 18h18M5 14a7 7 0 0 1 14 0M12 3v3M3 7l2 2m14 0 2-2M8 21h8" />,
    list: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 2h6v4H9zM8 13l2 2 5-5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />, lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    back: <path d="M19 12H5m6-6-6 6 6 6" />, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" /></>,
    refresh: <path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}
const hours = (c: CheckInContext) => c.service === "morning" ? "7 AM–3:59 PM" : c.category === "Special Meeting" ? "7 AM–11 PM" : "4 PM–11:59 PM";
const label = (c: CheckInContext, title: string) => c.service === "morning" ? "Morning Service" : c.service === "evening" ? "Evening Service" : c.category === "Special Meeting" ? title : c.category;
export default function CheckInPanel({ store, members, now, title, details = false, blocked, onList, onBack, onSaved, onContinue, onPending }: Props) {
  const [selected, setSelected] = useState(""), [search, setSearch] = useState("");
  const allowed = canManageTasks(members), data = store.data;
  const contexts = data?.contexts.filter(c => now.getTime() < Date.parse(c.visibleUntil)) ?? [];
  const chosen = contexts.find(c => contextKey(c) === selected) ?? contexts.find(c => checkInOpen(c, now)) ?? contexts[0];
  const busy = blocked || store.pending || store.loading;
  async function submit(c: CheckInContext) {
    onPending(true);
    try { const result = await store.save({ categoryId: c.categoryId, meetingDate: c.meetingDate, service: c.service, meetingId: c.meetingId, confirmed: true }); onSaved(result.members); onContinue(); }
    catch { /* The store displays an uncertain or rejected result without redirecting. */ }
    finally { onPending(false); }
  }
  if (details && !allowed) return <section className={styles.restricted}><CheckIcon name="shield" size={30} /><h2>Access restricted</h2><p>Check-in details are available only to Owners and Coordinators.</p><button onClick={onBack}>Back to Check in</button></section>;
  return <section className={`${styles.panel} ${!details&&allowed?styles.withDock:""}`} aria-busy={store.loading || store.pending}>
    <div className={styles.toolbar}>{details ? <button className={styles.back} onClick={onBack} disabled={busy}><CheckIcon name="back" size={17} />Back to Check in</button> : <div><p className={styles.welcome}>WELCOME BACK</p><h2 className={styles.greeting}>Praise the Lord, <span className={styles.userName}>{members?.current?.name ?? "friend"}</span><span>.</span></h2></div>}
      {details ? <button className={styles.iconButton} disabled={busy} aria-label="Refresh checked-in list" onClick={() => void store.refresh()}><CheckIcon name="refresh" /></button> : null}</div>
    {!details&&allowed&&<div className={styles.privateDock}><button className={styles.privateListButton} disabled={busy} onClick={onList} aria-label="Open checked-in list" title="Checked-in list"><CheckIcon name="list" size={22}/></button></div>}
    {store.error && <div className={styles.error} role="alert"><p>{store.error}</p><button onClick={() => void store.refresh()} disabled={store.loading || store.pending}>Refresh check-in</button></div>}
    {!data ? <div className={styles.empty} role="status"><CheckIcon name="list" size={30} /><h2>{store.loading ? "Loading check-in…" : "Check-in unavailable"}</h2><p>{store.loading ? "Getting your current meeting ready." : "Refresh to load your attendance safely."}</p><button disabled={busy} onClick={() => void store.refresh()}>Refresh</button></div> : !contexts.length ? <><NoMeeting now={now} /><button className={styles.submit} onClick={onContinue} disabled={busy}>Go to Assigned to me</button></> : <>
      <section className={heading.card}><span className={heading.calendar}><CheckIcon name="calendar" size={21} /></span><div className={heading.details}><p>CURRENT MEETING</p><h2>{chosen?.category === "Special Meeting" ? title : chosen?.category}</h2></div><span className={heading.days}>{chosen?.category === "Sunday Service" ? "Sun · Mon" : chosen?.category === "Healing Meeting" ? "Wed · Thu" : chosen?.category === "Revival Meeting" ? "Fri · Sat" : new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric" }).format(new Date(`${chosen?.meetingDate}T12:00:00+05:30`))}</span></section>
      {details ? <>
        {contexts.length > 1 && <div className={styles.tabs}>{contexts.map(c => <button key={contextKey(c)} className={chosen === c ? styles.selected : ""} onClick={() => setSelected(contextKey(c))}><CheckIcon name={c.service === "morning" ? "sun" : "evening"} size={17} />{c.service === "morning" ? "Morning" : "Evening"}<span>{data.entries?.filter(e => e.key === contextKey(c)).length ?? 0}</span></button>)}</div>}
        {chosen && <CheckedList context={chosen} data={data} people={members?.members ?? []} title={title} search={search} onSearch={setSearch} />}
        <p className={styles.private}><CheckIcon name="shield" size={15} />Visible only to Owners and Coordinators</p>
      </> : <>
        <div className={styles.services}>{[...contexts].sort((a, b) => Number(checkInOpen(b, now)) - Number(checkInOpen(a, now)) || Date.parse(a.opensAt) - Date.parse(b.opensAt)).map(c => {
          const checked = data.own.includes(contextKey(c)), open = checkInOpen(c, now), future = now.getTime() < Date.parse(c.opensAt), kind = c.service === "morning" ? "sun" : c.service === "evening" ? "evening" : "calendar";
          if(!open&&!checked)return <article className={`${styles.service} ${styles.nextService}`} key={contextKey(c)}><div className={styles.serviceTop}><span className={`${styles.serviceIcon} ${c.service==="evening"?styles.evening:""}`}><CheckIcon name={kind} size={23}/></span><div><p className={styles.kicker}>{future?"LATER TODAY":"CHECK-IN CLOSED"}</p><h2>{label(c,title)}</h2></div><CheckIcon name="lock" size={18}/></div><div className={styles.compactWindow}><CheckIcon name="clock" size={15}/><span>{hours(c)}</span><small>India time</small></div><div className={styles.nextBottom}><span>Not checked in</span><span>{future?`Opens at ${c.service==="morning"||c.category==="Special Meeting"?"7 AM":"4 PM"}`:"Check-in closed"}</span></div></article>;
          return <article className={`${styles.service} ${open || checked ? styles.openService : styles.nextService}`} key={contextKey(c)}>
            <div className={styles.serviceTop}><span className={`${styles.serviceIcon} ${c.service === "evening" ? styles.evening : ""}`}><CheckIcon name={kind} size={open || checked ? 27 : 23} /></span><span className={`${styles.openStatus} ${!open && !checked ? styles.closedStatus : ""}`}><span />{checked ? "Checked in" : open ? "Check-in open" : future ? "Later today" : "Check-in closed"}</span></div>
            <p className={styles.kicker}>{c.category}</p><h2>{label(c, title)}</h2>{(open || checked) && <p className={styles.intro}>{checked ? "Your check-in is saved for this service." : "Ready to serve? Let your team know you’re here."}</p>}
            <div className={styles.timeBox}><span><CheckIcon name="clock" size={19} /></span><div><small>CHECK-IN HOURS</small><strong>{hours(c)}</strong></div><span className={styles.timeZone}>India time</span></div>
            <button className={styles.submit} disabled={busy || (!open && !checked)} onClick={() => checked ? onContinue() : void submit(c)}><CheckIcon name={checked || open ? "check" : "lock"} size={19} /><span>{store.pending ? "Checking in…" : checked ? "Go to Assigned to me" : open ? "Check in" : future ? `Opens at ${c.service === "morning" || c.category === "Special Meeting" ? "7 AM" : "4 PM"}` : "Check-in closed"}</span>{(checked || open) && <span className={styles.arrow}>→</span>}</button>
            {(open || checked) && <p className={styles.actionNote}>{checked ? "Already checked in for this service" : "Then continue to Assigned to me"}</p>}
          </article>;
        })}</div><p className={styles.footnote}>Not checked in doesn’t mean absent.</p>
      </>}
    </>}
  </section>;
}
function CheckedList({ context, data, people, title, search, onSearch }: { context: CheckInContext; data: NonNullable<Store["data"]>; people: NonNullable<MemberState>["members"]; title: string; search: string; onSearch: (s: string) => void }) {
  const entries = (data.entries ?? []).filter(e => e.key === contextKey(context)).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || a.memberId.localeCompare(b.memberId));
  const visible = entries.flatMap(e => { const member = people.find(m => m.id === e.memberId); return member && member.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? [{ ...e, member }] : []; });
  return <>
    <div className={styles.summary}><span className={styles.summarySymbol}><CheckIcon name="users" size={22} /></span><div><p>CHECKED IN FOR THIS SERVICE</p><strong>{entries.length} {entries.length === 1 ? "member" : "members"} checked in</strong></div></div>
    <label className={styles.search}><CheckIcon name="search" size={18} /><input aria-label="Search checked-in members" placeholder="Find a member…" value={search} onChange={e => onSearch(e.target.value)} /></label>
    <section className={`${users.absentCard} ${styles.members}`}><div className={users.absentHeading}><h2>{label(context, title)}</h2><span className={styles.istLabel}>INDIA TIME</span></div>
      {visible.length ? <ul>{visible.map(e => <li key={e.memberId}><span className={`${users.absentAvatar} ${styles.presentAvatar}`}>{Array.from(e.member.name)[0]?.toLocaleUpperCase()}</span><div><strong>{e.member.name}</strong><p>{new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${context.meetingDate}T12:00:00+05:30`))}</p><time dateTime={e.checkedAt}><CheckIcon name="clock" size={13} />{new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(e.checkedAt))}<small>IST</small></time></div><span className={`${users.absentLabel} ${styles.presentLabel}`}>Checked in</span></li>)}</ul> : <div className={styles.empty}><CheckIcon name="users" size={26} /><h3>{search ? "No members found" : "No check-ins yet"}</h3><p>{search ? "Try another name." : "Members will appear here after checking in."}</p></div>}
    </section>
  </>;
}
