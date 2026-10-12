import type { Metadata } from "next";
import AuthShell from "@/components/auth/auth-shell";
import AuthForm from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account · Task App", robots: { index: false, follow: false } };

export default function SignUp() {
  return <AuthShell title="Create your account" description="A little more clarity. A space of your own."><AuthForm mode="signup" /></AuthShell>;
}
