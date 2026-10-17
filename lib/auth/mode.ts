// Access mode. Owner decision (17 Oct 2026): the dashboard is OPEN — no login.
// Set ACCESS_MODE=google on Vercel to switch Google sign-in + ALLOWED_EMAILS back on; no code change needed.
export function isOpenAccess(): boolean {
  return process.env.ACCESS_MODE !== "google";
}
