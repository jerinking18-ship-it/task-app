import { regularMeetingWindow } from "@/lib/tasks/meeting-period";
import styles from "./assigned-meeting-heading.module.css";

const DAYS: Record<string, string> = {
  "Sunday Service": "Sun · Mon",
  "Healing Meeting": "Wed · Thu",
  "Revival Meeting": "Fri · Sat",
};

// A day-based context label only. The existing assignment list and filters
// continue to include the viewer's retained work from every category.
export default function AssignedMeetingHeading({ now }: { now: Date }) {
  const { category } = regularMeetingWindow(now);
  return <section className={styles.card} aria-label="Current meeting" aria-live="polite">
    <span className={styles.calendar}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/></svg></span>
    <div className={styles.details}><p>CURRENT MEETING</p><h2>{category || "No meeting today"}</h2></div>
    <span className={styles.days}>{DAYS[category] || "Tue"}</span>
  </section>;
}
