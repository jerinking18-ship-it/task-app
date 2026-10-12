import { NextResponse } from "next/server";
import { validateAuthInput } from "@/lib/auth/validation";
import { runAuthAction } from "@/lib/auth/flow";
import { authDependencies, authOrigin, AUTH_HEADERS } from "@/lib/auth/server";

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== authOrigin()) {
      return NextResponse.json({ message: "Please submit this form from the Task App address." }, { status: 403, headers: AUTH_HEADERS });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return NextResponse.json({ message: "Invalid form request." }, { status: 415, headers: AUTH_HEADERS });
    }
    const body = await request.text();
    if (body.length > 8192) return NextResponse.json({ message: "Form request is too large." }, { status: 413, headers: AUTH_HEADERS });
    let value: unknown;
    try { value = JSON.parse(body); } catch { value = null; }
    const { input, fields } = validateAuthInput(value);
    if (!input) return NextResponse.json({ fields, message: "Check the highlighted fields and try again." }, { status: 400, headers: AUTH_HEADERS });
    const { status, ...reply } = await runAuthAction(input, await authDependencies());
    return NextResponse.json(reply, { status, headers: {
      ...AUTH_HEADERS, ...(reply.retryAfter ? { "Retry-After": String(reply.retryAfter) } : {}),
    } });
  } catch {
    return NextResponse.json({ message: "We couldn’t reach sign-in right now. If you requested an email, check your inbox before trying again." }, { status: 503, headers: AUTH_HEADERS });
  }
}
