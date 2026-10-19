import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_LABEL, isRole, type DashboardRole } from "./passwords";

export interface DashboardUser {
  role: DashboardRole;
  label: string;
}

/** Returns the signed-in user or null. The session callback in auth.ts has already re-validated the password. */
export async function getUser(): Promise<DashboardUser | null> {
  const session = await auth();
  const role = (session?.user as { role?: unknown } | undefined)?.role;
  if (!isRole(role)) return null;
  return { role, label: ROLE_LABEL[role] };
}

/**
 * Authorization check for pages and layouts (there is no proxy/middleware, so this is the gate), and every
 * data-access function calls assertUser() as well (defence in depth).
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
