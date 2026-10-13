import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedIdentity } from "@/lib/auth/flow";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { memberAction } from "@/lib/members/model";
import { chooseMember, leaveMember, MemberError, readMembers, renameMember } from "@/lib/members/server";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: AUTH_HEADERS });
async function clientForRequest() {
  const client = await createClient();
  if (!await verifiedIdentity(client.auth)) throw new MemberError(401, "Your session has ended. Sign in again to continue.");
  return client;
}
async function failed(error: unknown, client?: SupabaseClient) {
  if (client && error instanceof MemberError && error.status === 401) {
    try { await client.auth.signOut({ scope: "local" }); } catch { /* App access is already denied. */ }
  }
  return error instanceof MemberError ? json({ message: error.message }, error.status)
    : json({ message: "We couldn’t confirm your member details. Refresh before trying again." }, 503);
}
export async function GET() {
  let client;
  try { client = await clientForRequest(); return json(await readMembers(client)); } catch (error) { return failed(error, client); }
}
export async function POST(request: Request) {
  let client;
  try {
    if (request.headers.get("origin") !== authOrigin()) return json({ message: "Please use the Task App address to continue." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ message: "Invalid member request." }, 415);
    client = await clientForRequest();
    const reader = request.body?.getReader();
    if (!reader) return json({ message: "Missing member details." }, 400);
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ message: "Member request is too large." }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return json({ message: "Invalid member details." }, 400); }
    const action = memberAction(value);
    if (!action) return json({ message: "Enter a name between 1 and 50 characters, or choose an existing member." }, 400);
    if (action.action === "rename") return json(await renameMember(client, action.name, action.previousName));
    if (action.action === "leave") {
      await leaveMember(client);
      // Revocation is committed already. Cookie cleanup must never imply it failed.
      try { await client.auth.signOut({ scope: "local" }); } catch { /* Other linked app sessions remain revoked. */ }
      return json({ left: true, redirectTo: "/sign-in?notice=profile-left" });
    }
    return json(await chooseMember(client, action));
  } catch (error) { return failed(error, client); }
}
