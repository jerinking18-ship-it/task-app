import type { Metadata } from "next";
import AuthShell from "@/components/auth/auth-shell";
import AuthForm from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Reset password · Task App", robots: { index: false, follow: false } };
export default function ForgotPassword() {
  return <AuthShell title="Forgot your password?" description="Enter your account’s email address. We’ll help you get back in."><AuthForm mode="forgot" /></AuthShell>;
}
