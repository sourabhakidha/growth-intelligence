// Pure shared-password logic (no Next/Auth imports) so it can be unit-tested. Uses Web Crypto only, so it runs
// in Node, the Edge runtime and Netlify functions alike.
//
// Env (server only): DASHBOARD_PASSWORD (viewer), DASHBOARD_PASSWORD_ADMIN, DASHBOARD_PASSWORD_FINANCE.
// An unset or empty variable disables that role.

export type DashboardRole = "admin" | "finance" | "viewer";

export const ROLE_ENV: Record<DashboardRole, string> = {
  admin: "DASHBOARD_PASSWORD_ADMIN",
  finance: "DASHBOARD_PASSWORD_FINANCE",
  viewer: "DASHBOARD_PASSWORD",
};

export const ROLE_LABEL: Record<DashboardRole, string> = {
  admin: "Admin",
  finance: "Finance",
  viewer: "Viewer",
};

/** Checked in this order if two roles ever share a password. */
const ROLES: DashboardRole[] = ["admin", "finance", "viewer"];

type Env = Record<string, string | undefined>;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Constant-time comparison of equal-length digests. */
function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}

/** Returns the role whose password matches, or null. Every configured role is compared, matched or not. */
export async function matchRole(password: unknown, env: Env): Promise<DashboardRole | null> {
  if (typeof password !== "string" || password.length === 0) return null;
  const given = await sha256(password);
  let match: DashboardRole | null = null;
  for (const role of ROLES) {
    const expected = env[ROLE_ENV[role]];
    if (!expected) continue;
    if (digestsEqual(given, await sha256(expected)) && match === null) match = role;
  }
  return match;
}

/**
 * A short hash of the role's current password, stored in the (encrypted) session token. Changing or removing a
 * password changes the fingerprint, which signs out everyone who used the old one.
 */
export async function passwordFingerprint(role: DashboardRole, env: Env): Promise<string | null> {
  const pw = env[ROLE_ENV[role]];
  if (!pw) return null;
  const bytes = await sha256(`dashboard-role:${role}:${pw}`);
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isRole(v: unknown): v is DashboardRole {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

/** Deny by default: unknown role, disabled role or a stale fingerprint is not a valid session. */
export async function isSessionValid(role: unknown, fingerprint: unknown, env: Env): Promise<boolean> {
  if (!isRole(role) || typeof fingerprint !== "string") return false;
  const current = await passwordFingerprint(role, env);
  return current !== null && current === fingerprint;
}
