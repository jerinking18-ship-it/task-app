import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function CheckMark({ large = false }: { large?: boolean }) {
  return <span className={large ? styles.largeMark : styles.mark} aria-hidden="true"><svg width={large ? 28 : 21} height={large ? 28 : 21} viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}

export default function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className={styles.shell}>
    <a href="#auth-content" className={styles.skipLink}>Skip to sign-in form</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><CheckMark /><span>Task App<span className={styles.brandDot}>.</span></span></Link>
      <Link href="/" className={styles.previewLink}>View task preview <span aria-hidden="true">↗</span></Link>
    </header>
    <main id="auth-content" className={styles.main}>
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.cardAccent} />
        <p className={styles.eyebrow}>YOUR TASK APP</p>
        <h1 id="auth-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {children}
      </section>
      <p className={styles.footer}><svg width="13" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" /></svg> A private space for your tasks.</p>
    </main>
  </div>;
}
