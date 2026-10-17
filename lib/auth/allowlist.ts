// Pure allow-list logic (no Next/Auth imports) so it can be unit-tested.
// ALLOWED_EMAILS: comma/space separated list of exact emails and/or "@domain.com" entries.

export function parseAllowList(raw: string | undefined): { emails: Set<string>; domains: Set<string> } {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (v.startsWith("@") && v.length > 1) domains.add(v.slice(1));
    else if (v.includes("@")) emails.add(v);
  }
  return { emails, domains };
}

/** Deny by default: an empty or missing allow-list admits nobody. */
export function isEmailAllowed(email: string | null | undefined, raw: string | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return false;
  const { emails, domains } = parseAllowList(raw);
  return emails.has(e) || domains.has(e.slice(at + 1));
}
