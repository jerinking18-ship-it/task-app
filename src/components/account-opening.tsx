import AuthShell from "@/components/auth/auth-shell";
import styles from "@/components/auth/auth.module.css";

/** Stream existing app styling after identity verification, without private data. */
export default function AccountOpening() {
  return <AuthShell eyebrow="PRAISE THE LORD" title="Loading your space…" description="Getting your saved tasks ready.">
    <div role="status" aria-label="Opening your workspace" aria-live="polite" aria-busy="true" className={styles.spinner}/>
  </AuthShell>;
}
