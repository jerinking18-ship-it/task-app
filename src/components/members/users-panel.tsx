"use client";
import { MEMBER_LIMIT, memberSeen, type MemberState } from "@/lib/members/model";
import styles from "./members.module.css";

export default function UsersPanel({ state, loading, error, onRefresh, now }: {
  state: MemberState | null; loading: boolean; error: string; onRefresh: () => void; now: Date;
}) {
  const members = state ? [...state.members].sort((first, second) =>
    Number(second.id === state.current?.id) - Number(first.id === state.current?.id)) : [];
  return <section className={styles.usersPanel} aria-label="Account users" aria-busy={loading}>
    <div className={styles.usersTop}><div><h2>{state ? `${state.members.length} of ${MEMBER_LIMIT} members` : "Account members"}</h2><p>Up to 10 named members</p></div><button type="button" className={styles.refresh} disabled={loading} onClick={onRefresh}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    {state && <div className={styles.capacityBar} role="progressbar" aria-label="Member spaces used" aria-valuenow={state.members.length} aria-valuemin={0} aria-valuemax={MEMBER_LIMIT}><span style={{ width: `${state.members.length * 10}%` }}/></div>}
    {error && <p className={styles.usersError} role="alert">{error}</p>}
    {!state && loading && <p role="status">Loading account members…</p>}
    {state && <ul className={styles.usersList}>{members.map(member => <li key={member.id}>
      <span className={`${styles.avatar} ${state.current?.id === member.id ? styles.yourAvatar : ""}`} aria-hidden="true">{Array.from(member.name)[0]?.toLocaleUpperCase()}</span>
      <div className={styles.userDetails}><div className={styles.userName}><span>{member.name}</span>{state.current?.id === member.id && <span className={styles.you}>You</span>}</div><time dateTime={member.lastSeenAt}>{memberSeen(member.lastSeenAt, now)}</time></div>
    </li>)}</ul>}
    {state?.members.length === 0 && <p>No members yet. Add your name when you sign in.</p>}
    <p className={styles.usersNote}>Names appear on completed tasks.</p>
  </section>;
}
