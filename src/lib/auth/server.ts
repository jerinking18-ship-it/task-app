import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "./recovery";

export function authOrigin() {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new Error("Set APP_ORIGIN to the app’s exact URL.");
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("APP_ORIGIN must be an HTTPS origin or a local HTTP origin.");
  }
  return url.origin;
}

export async function authDependencies() {
  const cookieStore = await cookies();
  const client = await createClient();
  const origin = authOrigin();
  const secret = process.env.AUTH_RECOVERY_SECRET ?? "";
  if (secret.length < 32 || secret.startsWith("replace_")) throw new Error("Set a random server-only AUTH_RECOVERY_SECRET of at least 32 characters.");
  return {
    auth: client.auth, origin, secret,
    recoveryGrant: cookieStore.get(RECOVERY_COOKIE)?.value,
    setRecoveryGrant(value: string, maxAge: number) {
      cookieStore.set(RECOVERY_COOKIE, value, {
        httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge,
      });
    },
  };
}

export const AUTH_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache", Expires: "0", "Referrer-Policy": "no-referrer",
};
