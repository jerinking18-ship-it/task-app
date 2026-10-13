import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/flow";
import { authOrigin, AUTH_HEADERS } from "@/lib/auth/server";
import { TaskError, TaskRepository } from "@/lib/tasks/repository";
import { validateAction } from "@/lib/tasks/validation";
import { MemberError, readMembers } from "@/lib/members/server";

function json(body: unknown, status=200) { return NextResponse.json(body,{status,headers:AUTH_HEADERS}); }
async function repository() {
  const client = await createClient(); const identity = await verifiedIdentity(client.auth);
  if (!identity) throw new TaskError(401,"Your session has ended. Sign in again to continue.");
  try {
    if (!(await readMembers(client)).current) throw new TaskError(403,"Choose your name before saving or viewing tasks.");
  } catch (error) {
    if (error instanceof MemberError && error.status === 401) {
      try { await client.auth.signOut({ scope: "local" }); } catch { /* Fail closed even if cookie cleanup fails. */ }
    }
    throw error;
  }
  return new TaskRepository(client,identity.userId);
}
function failure(error: unknown) {
  if (error instanceof MemberError) return json({message:error.message},error.status);
  return error instanceof TaskError ? json({message:error.message,latest:error.latest,categories:error.categories,future:error.future},error.status)
    : json({message:"We couldn’t confirm this request. Refresh to check saved data before trying again."},503);
}
export async function GET() {
  try { return json(await (await repository()).read()); } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== authOrigin()) return json({message:"Please use the Task App address to save changes."},403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({message:"Invalid save request."},415);
    // Enforce a byte limit while streaming, rather than allocating an unbounded body.
    const reader = request.body?.getReader(); if (!reader) return json({message:"Missing save request."},400);
    const chunks: Uint8Array[] = []; let length=0;
    for (;;) {
      const {done,value} = await reader.read(); if(done) break;
      length += value.byteLength;
      if(length>393216) { await reader.cancel(); return json({message:"Save request is too large."},413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset=0;
    for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    let value: unknown;
    try { value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); } catch { return json({message:"Invalid save request."},400); }
    const input=validateAction(value);
    if(!input) return json({message:"Check the task details and try again."},400);
    return json(await (await repository()).mutate(input));
  } catch(error) { return failure(error); }
}
