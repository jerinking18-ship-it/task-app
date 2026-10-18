import { NextResponse } from "next/server";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { createClient } from "@/lib/supabase/server";
import { MemberError } from "@/lib/members/server";
import { decodeMembers } from "@/lib/members/model";
import { checkInAction, decodeCheckIn } from "@/lib/check-in/model";
import { readCheckIn, saveCheckIn } from "@/lib/check-in/server";
import { isRecord } from "@/lib/tasks/validation";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: AUTH_HEADERS });
async function client() { const c = await createClient(); if (!await verifiedIdentity(c.auth)) throw new MemberError(401, "Sign in with your verified personal email to continue."); return c; }
const failure = (error: unknown) => error instanceof MemberError ? json({ message: error.message }, error.status) : json({ message: "Check-in is unavailable. Refresh before trying again." }, 503);
export async function GET(request: Request) {
  try { const q = new URL(request.url).searchParams; if (q.size > 1 || [...q.keys()].some(k => k !== "details") || (q.has("details") && q.get("details") !== "1")) return json({ message: "Invalid check-in request." }, 400); return json(await readCheckIn(await client(), q.get("details") === "1")); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== authOrigin()) return json({ message: "Please use the app address to check in." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ message: "Invalid check-in request." }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ message: "Missing check-in request." }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 2048) { await reader.cancel(); return json({ message: "Check-in request is too large." }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return json({ message: "Invalid check-in request." }, 400); }
    const action = checkInAction(value); if (!action) return json({ message: "Choose the meeting and service before checking in." }, 400);
    const result = await saveCheckIn(await client(), action);
    if (!isRecord(result)) throw Error("Incomplete confirmation");
    return json({ state: decodeCheckIn(result.state), members: decodeMembers(result.members) });
  } catch (e) { return failure(e); }
}
