import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../src/lib/supabase/config.ts";

// Read-only: no sign-in, emails, users, table writes, or schema changes.
try {
  const { url, publishableKey } = getSupabaseConfig();
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const headers = { apikey: publishableKey };

  const [auth, ...tableProbes] = await Promise.all([
    fetch(`${url}/auth/v1/settings`, {
      headers, signal: AbortSignal.timeout(15000),
    }),
    // Select zero rows without a session. The deployed private schema must deny
    // both requests; success or a missing-table error is a verification failure.
    ...["tasks", "categories"].map((table) =>
      supabase.from(table).select("id").limit(0).abortSignal(AbortSignal.timeout(15000))),
  ]);

  console.log(`Supabase Auth settings: HTTP ${auth.status}`);
  await auth.body?.cancel();
  if (!auth.ok) {
    throw new Error("Auth connection check failed. Verify the public settings.");
  }
  for (const [index, probe] of tableProbes.entries()) {
    const table = ["tasks", "categories"][index];
    console.log(`Signed-out ${table} read: HTTP ${probe.status}, code ${probe.error?.code ?? "none"}`);
    if (![401, 403].includes(probe.status) || probe.error?.code !== "42501") {
      throw new Error("Signed-out privacy check failed. Expected permission denial for both private tables.");
    }
  }
  console.log("Read-only connection/privacy check passed. Live signed-in saving and account isolation still need testing.");
} catch (error) {
  // Report a controlled message, never response bodies, request headers, or keys.
  console.error(error instanceof Error && !error.message.includes("sb_")
    ? error.message
    : "Supabase connection check failed.");
  process.exitCode = 1;
}
