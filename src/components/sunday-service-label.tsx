import type { SundayService } from "@/lib/tasks/model";
import styles from "./sunday-service.module.css";
export function SundayServiceIcon({value}:{value:SundayService}) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{value==="morning"?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></>:<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>}</svg>;
}
export const sundayServiceName=(value:SundayService)=>value==="morning"?"Morning Service":"Evening Service";
export default function SundayServiceLabel({value}:{value:SundayService}) {
  return <span className={`${styles.label} ${styles[value]}`}><SundayServiceIcon value={value}/>{sundayServiceName(value)}</span>;
}
