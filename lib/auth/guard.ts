import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isEmailAllowed } from "./allowlist";
import { isOpenAccess } from "./mode";

export interface DashboardUser {
  email: string;
  name: string | null;
}

/** Returns the signed-in, allow-listed user or null. Never trusts the client. */
export async function getUser(): Promise<DashboardUser | null> {
  if (isOpenAccess()) return { email: "Open access (no login)", name: null };
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isEmailAllowed(email, process.env.ALLOWED_EMAILS)) return null;
  return { email, name: session.user?.name ?? null };
}

/**
 * Authorization check for pages and layouts. proxy.ts only does an optimistic redirect; this is the
 * real check, and every data-access function calls assertUser() as well (defence in depth).
 */
export async function requireUser(): Promise<DashboardUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** For data-access modules and route handlers: throw instead of redirecting. */
export async function assertUser(): Promise<DashboardUser> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
