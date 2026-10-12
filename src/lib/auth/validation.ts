export type AuthAction = "password" | "signup" | "email-link" | "recover" | "reset" | "sign-out";
export type FieldErrors = Partial<Record<"email" | "password" | "confirmation", string>>;
export type AuthInput = { action: AuthAction; email?: string; password?: string; confirmation?: string };
export type AuthReply = { message?: string; fields?: FieldErrors; redirectTo?: string; retryAfter?: number };

export function validateAuthInput(value: unknown): { input?: AuthInput; fields: FieldErrors } {
  if (!value || typeof value !== "object") return { fields: {} };
  const data = value as Record<string, unknown>;
  if (!["password", "signup", "email-link", "recover", "reset", "sign-out"].includes(String(data.action))) {
    return { fields: {} };
  }
  const action = data.action as AuthAction;
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const confirmation = typeof data.confirmation === "string" ? data.confirmation : "";
  const fields: FieldErrors = {};
  if (["password", "signup", "email-link", "recover"].includes(action) &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    fields.email = "Enter a valid email address.";
  }
  if (action === "password" && (!password || password.length > 1024)) {
    fields.password = "Enter your password.";
  }
  if (action === "reset") {
    if (password.length < 6 || password.length > 1024) fields.password = "Use at least 6 characters.";
    if (password !== confirmation) fields.confirmation = "Your passwords do not match.";
  }
  if (action === "signup") {
    if (password.length < 8 || password.length > 1024) fields.password = "Use at least 8 characters.";
    if (password !== confirmation) fields.confirmation = "Your passwords do not match.";
  }
  return { input: Object.keys(fields).length ? undefined : { action, email, password, confirmation }, fields };
}
