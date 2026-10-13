import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { MemberError, readMembers } from "@/lib/members/server";
import { TaskError } from "@/lib/tasks/repository";
import { CompletedRepository } from "@/lib/tasks/completed-repository";
import { validateCompletedPurge } from "@/lib/tasks/completed";
const json = (body: unknown, status=200) => NextResponse.json(body, { status, headers: AUTH_HEADERS });
async function repository() {
  const client = await createClient();
  if (!await verifiedIdentity(client.auth)) throw new TaskError(401, "Your session has ended. Sign in again to continue.");
  try { if (!(await readMembers(client)).current) throw new TaskError(403, "Choose your name before deleting completed tasks."); }
  catch (error) {
    if (error instanceof MemberError && error.status === 401) {
      try { await client.auth.signOut({ scope: "local" }); } catch { /* Access is already denied. */ }
    }
    throw error;
  }
  return new CompletedRepository(client);
}
const failed = (error: unknown) => error instanceof TaskError || error instanceof MemberError
  ? json({ message: error.message }, error.status) : json({ message: "Deletion could not be confirmed. Close and refresh before trying again." }, 503);
export async function GET() {
  try { return json(await (await repository()).read()); } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== authOrigin()) return json({ message: "Please use the Task App address to continue." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ message: "Invalid deletion request." }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ message: "Missing confirmation." }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 1024) { await reader.cancel(); return json({ message: "Deletion request is too large." }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal:true }).decode(bytes)); } catch { return json({ message: "Invalid confirmation." }, 400); }
    const input = validateCompletedPurge(value);
    if (!input) return json({ message: "Review the completed task count and confirm permanent deletion." }, 400);
    return json(await (await repository()).purge(input));
  } catch (error) { return failed(error); }
}
