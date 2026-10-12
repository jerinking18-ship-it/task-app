import Link from "next/link";
import type { Metadata } from "next";
import AuthShell from "@/components/auth/auth-shell";
import AuthForm from "@/components/auth/auth-form";
import { authDependencies } from "@/lib/auth/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { verifyRecoveryGrant } from "@/lib/auth/recovery";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "Choose a new password · Task App", robots: { index: false, follow: false } };
export default async function ResetPassword() {
  let valid = false;
  try {
    const deps = await authDependencies();
    const identity = await verifiedIdentity(deps.auth);
    valid = !!identity && verifyRecoveryGrant(deps.recoveryGrant, identity, deps.secret);
  } catch { /* Render a recoverable state without exposing session/config details. */ }
  if (!valid) return <AuthShell title="Let’s get a fresh link" description="Open a valid password reset link in the browser where you requested it. Links can expire or be used only once.">
    <Link href="/auth/forgot-password" className={styles.primary}>Request a new reset link <span aria-hidden="true">→</span></Link>
    <Link href="/sign-in" className={styles.backLink}>Back to sign in</Link>
  </AuthShell>;
  return <AuthShell title="Choose a new password" description="Make it unique to your account. You’ll use it the next time you sign in."><AuthForm mode="reset" /></AuthShell>;
}
