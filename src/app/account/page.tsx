import { redirect } from "next/navigation";
import type { Metadata } from "next";
import TaskApp from "@/components/task-app";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { MemberError, readMembers } from "@/lib/members/server";

export const metadata: Metadata = { title: "My tasks · Task App", robots: { index: false, follow: false } };
export default async function Account({ searchParams }: PageProps<"/account">) {
  let client;
  let identity;
  try { client = await createClient(); identity = await verifiedIdentity(client.auth); } catch { /* Fail closed. */ }
  if (!identity || !client) redirect("/sign-in");
  let members;
  try { members = await readMembers(client); } catch (error) {
    if (error instanceof MemberError && error.status === 401) redirect("/sign-in");
    /* Recover other failures through the member step. */
  }
  if (!members?.current) redirect("/account/member");
  const query = await searchParams;
  return <TaskApp saved accountId={identity.userId} today={new Date().toISOString().slice(0, 10)} initialMembers={members} accountEmail={identity.email} passwordUpdated={query.password === "updated"} />;
}
