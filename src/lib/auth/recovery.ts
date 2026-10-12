import { createHmac, timingSafeEqual } from "node:crypto";

export const RECOVERY_COOKIE = "task-app-recovery";
export const RECOVERY_SECONDS = 10 * 60;
type Identity = { userId: string; sessionId: string };

function signature(body: string, secret: string) {
  if (secret.length < 32) throw new Error("Configure AUTH_RECOVERY_SECRET before using password recovery.");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createRecoveryGrant(identity: Identity, secret: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...identity, expires: now + RECOVERY_SECONDS * 1000 })).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function verifyRecoveryGrant(value: string | undefined, identity: Identity, secret: string, now = Date.now()) {
  try {
    if (!value || value.length > 2048) return false;
    const [body, signed, extra] = value.split(".");
    if (!body || !signed || extra) return false;
    const expected = Buffer.from(signature(body, secret));
    const actual = Buffer.from(signed);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return grant.userId === identity.userId && grant.sessionId === identity.sessionId &&
      Number.isFinite(grant.expires) && grant.expires > now && grant.expires <= now + RECOVERY_SECONDS * 1000;
  } catch {
    return false;
  }
}
