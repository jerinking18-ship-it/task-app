import type { Metadata } from "next";
import AuthShell from "@/components/auth/auth-shell";
import AuthForm from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in · Task App", robots: { index: false, follow: false } };

export default async function SignIn({ searchParams }: PageProps<"/sign-in">) {
  const query = await searchParams;
  const linkError = query.error === "link";
  const message = linkError ? "That link is invalid, expired, or was opened in a different browser. Request a new link below and open it here."
    : query.notice === "password-updated" ? "Password updated. Sign in with your new password."
    : query.notice === "signed-out" ? "You’re signed out of this browser." : "";
  return <AuthShell title="Sign in to Task App" description="Your tasks, right where you left them."><AuthForm initialMessage={message} initialError={linkError} /></AuthShell>;
}
