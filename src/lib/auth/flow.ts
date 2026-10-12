import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthInput, AuthReply } from "./validation";
import { createRecoveryGrant, verifyRecoveryGrant, RECOVERY_SECONDS } from "./recovery";

export type AuthApi = SupabaseClient["auth"];
export type AuthDependencies = {
  auth: AuthApi;
  origin: string;
  secret: string;
  recoveryGrant?: string;
  setRecoveryGrant: (value: string, maxAge: number) => void;
};
export type AuthResult = AuthReply & { status: number };

export async function verifiedIdentity(auth: AuthApi) {
  const { data: claimsData, error: claimsError } = await auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims || typeof claims.sub !== "string" || typeof claims.session_id !== "string") return null;
  const { data, error } = await auth.getUser();
  if (error || !data.user || data.user.id !== claims.sub) return null;
  return { userId: claims.sub, sessionId: claims.session_id };
}

function authFailure(error: { status?: number; code?: string }, password = false): AuthResult {
  if (error.status === 429) return { status: 429, retryAfter: 60, message: "Too many requests. Please wait a minute before trying again." };
  if (!error.status || error.status >= 500) return { status: 503, message: "Sign-in is temporarily unavailable. Please try again shortly." };
  return { status: 400, message: password ? "Unable to sign in. Check your email and password, or use an email link." : "We couldn’t complete that request. Please try again." };
}

export async function runAuthAction(input: AuthInput, deps: AuthDependencies): Promise<AuthResult> {
  const { auth } = deps;
  switch (input.action) {
    case "signup": {
      const { data, error } = await auth.signUp({ email: input.email!, password: input.password!, options: {
        emailRedirectTo: `${deps.origin}/auth/callback`,
      } });
      const inbox: AuthResult = { status: 200, retryAfter: 60, message: "If this address can be registered, check your inbox for a confirmation link. Open it in this browser. If you already have an account, sign in instead." };
      if (error) {
        if (["user_already_exists", "email_exists"].includes(error.code ?? "")) return inbox;
        if (error.code === "weak_password") return { status: 400, fields: { password: "Choose a stronger password that meets the account requirements." }, message: "Please choose a stronger password." };
        if (error.status === 429) return authFailure(error);
        return { status: error.status && error.status < 500 ? 400 : 503, message: "We couldn’t create the account right now. Please try again later, or sign in if you already have an account." };
      }
      if (data.session) {
        if (!await verifiedIdentity(auth)) return { status: 401, message: "We couldn’t verify your account session. Please sign in to continue." };
        deps.setRecoveryGrant("", 0);
        return { status: 200, redirectTo: "/account" };
      }
      return inbox;
    }
    case "password": {
      const { error } = await auth.signInWithPassword({ email: input.email!, password: input.password! });
      if (error) return authFailure(error, true);
      if (!await verifiedIdentity(auth)) return { status: 401, message: "We couldn’t verify your sign-in. Please try again." };
      deps.setRecoveryGrant("", 0);
      return { status: 200, redirectTo: "/account" };
    }
    case "email-link": {
      const { error } = await auth.signInWithOtp({ email: input.email!, options: {
        shouldCreateUser: false, emailRedirectTo: `${deps.origin}/auth/callback`,
      } });
      // Account-related 4xx responses must be indistinguishable from success.
      // Operational failures/rate limits can be reported without account details.
      if (error && (!error.status || error.status === 429 || error.status >= 500)) return authFailure(error);
      return { status: 200, retryAfter: 60, message: "If this email belongs to an existing account, check your inbox for a sign-in link. Open it in this browser." };
    }
    case "recover": {
      const { error } = await auth.resetPasswordForEmail(input.email!, { redirectTo: `${deps.origin}/auth/callback` });
      if (error && (!error.status || error.status === 429 || error.status >= 500)) return authFailure(error);
      return { status: 200, retryAfter: 60, message: "If this email belongs to an existing account, check your inbox for a password reset link. Open it in this browser." };
    }
    case "reset": {
      const identity = await verifiedIdentity(auth);
      if (!identity || !verifyRecoveryGrant(deps.recoveryGrant, identity, deps.secret)) {
        deps.setRecoveryGrant("", 0);
        return { status: 401, message: "Your reset link is missing or expired. Request a new one to continue." };
      }
      const { error } = await auth.updateUser({ password: input.password! });
      if (error) {
        if (["weak_password", "same_password"].includes(error.code ?? "")) return { status: 400, message: "Choose a different, stronger password that meets your account’s requirements." };
        return authFailure(error);
      }
      deps.setRecoveryGrant("", 0);
      // End this browser's recovery session. A failure to sign out does not undo
      // a successful password change, and must never encourage repeating it.
      try {
        const { error: signOutError } = await auth.signOut({ scope: "local" });
        return { status: 200, redirectTo: signOutError ? "/account?password=updated" : "/sign-in?notice=password-updated" };
      } catch {
        return { status: 200, redirectTo: "/account?password=updated" };
      }
    }
    case "sign-out": {
      const { error } = await auth.signOut({ scope: "local" });
      if (error) return authFailure(error);
      deps.setRecoveryGrant("", 0);
      return { status: 200, redirectTo: "/sign-in?notice=signed-out" };
    }
  }
}

export async function completeCallback(code: string | null, flowId: string | null, deps: AuthDependencies) {
  deps.setRecoveryGrant("", 0);
  if (!code || code.length > 2048 || (flowId && !/^[a-zA-Z0-9_-]{1,128}$/.test(flowId))) return "/sign-in?error=link";
  const { data, error } = await deps.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error) return "/sign-in?error=link";
  const identity = await verifiedIdentity(deps.auth);
  if (!identity) return "/sign-in?error=link";
  // Trust the SDK's redirect type recovered from its PKCE verifier, never a
  // user-controlled ?type=recovery or ?next= query parameter.
  // The installed SDK returns redirectType at runtime, but its public
  // AuthTokenResponse type omits it. If absent, never grant recovery access.
  if ("redirectType" in data && data.redirectType === "recovery") {
    deps.setRecoveryGrant(createRecoveryGrant(identity, deps.secret), RECOVERY_SECONDS);
    return "/auth/reset-password";
  }
  return "/account";
}
