import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

/** Refresh sessions without sharing clients or cookies between requests. */
export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = getSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        // The SDK sends cache headers only on its first cookie write. Preserve
        // them, and earlier cookie writes, when rebuilding the forwarded request.
        const previousCookies = response.cookies.getAll();
        const previousCacheHeaders = ["cache-control", "expires", "pragma"].map(
          (name) => [name, response.headers.get(name)] as const,
        );
        response = NextResponse.next({ request });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        previousCacheHeaders.forEach(([name, value]) => {
          if (value) response.headers.set(name, value);
        });
        Object.entries(cacheHeaders).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // Verifies claims and refreshes when needed. Anonymous preview visitors are
  // allowed; protected routes must separately require valid claims when added.
  await supabase.auth.getClaims();
  return response;
}
