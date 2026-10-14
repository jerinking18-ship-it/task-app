import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthShell from "@/components/auth/auth-shell";
import MemberForm from "@/components/members/member-form";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { MemberError, readMembers } from "@/lib/members/server";

export const metadata: Metadata = { title: "Join workspace · BGM Task App", robots: { index: false, follow: false } };
export default async function MemberStep() {
  let client; let signedIn = false;
  try { client = await createClient(); signedIn = !!await verifiedIdentity(client.auth); } catch { /* Fail closed. */ }
  if (!signedIn || !client) redirect("/sign-in");
  let state = null;
  try { state = await readMembers(client); } catch (error) {
    if (error instanceof MemberError && error.status === 401) redirect("/sign-in");
    /* The form offers an explicit retry for temporary failures. */
  }
  if (state?.current && state.workspace) redirect("/account");
  return <AuthShell eyebrow="PRAISE THE LORD" title="Join your workspace" description="Use your personal verified email and workspace invitation.">
    <MemberForm initialState={state} signedIn/>
  </AuthShell>;
}
