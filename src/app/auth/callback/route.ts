import { NextResponse } from "next/server";
import { completeCallback } from "@/lib/auth/flow";
import { authDependencies, authOrigin, AUTH_HEADERS } from "@/lib/auth/server";

export async function GET(request: Request) {
  let target = "/sign-in?error=link";
  try {
    const url = new URL(request.url);
    if (!url.searchParams.has("error")) {
      target = await completeCallback(url.searchParams.get("code"), url.searchParams.get("sb_flow_id"), await authDependencies());
    }
    return NextResponse.redirect(new URL(target, authOrigin()), { status: 303, headers: AUTH_HEADERS });
  } catch {
    // Fixed relative destination: never trust callback parameters or Host for
    // redirects, and never put provider errors or tokens into the next URL.
    return new NextResponse(null, { status: 303, headers: { ...AUTH_HEADERS, Location: "/sign-in?error=link" } });
  }
}
