import { redirect } from "next/navigation";
import type { Metadata } from "next";
import TaskApp from "@/components/task-app";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";

export const metadata: Metadata = { title: "My tasks · Task App", robots: { index: false, follow: false } };
export default async function Account({ searchParams }: PageProps<"/account">) {
  let signedIn = false;
  try { signedIn = !!await verifiedIdentity((await createClient()).auth); } catch { /* Fail closed. */ }
  if (!signedIn) redirect("/sign-in");
  const query = await searchParams;
  return <TaskApp saved today={new Date().toISOString().slice(0, 10)} passwordUpdated={query.password === "updated"} />;
}
