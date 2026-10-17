// IST (Asia/Kolkata) date handling. All reporting dates are calendar dates in IST,
// represented as "YYYY-MM-DD" strings so they never shift across server/browser time zones.

export const IST_TZ = "Asia/Kolkata";
export const MAX_RANGE_DAYS = 400;

export type IsoDate = string; // YYYY-MM-DD (IST calendar date)

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const istDateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const displayDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const displayDateShort = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
});

const displayDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Today's calendar date in IST. */
export function todayIST(now: Date = new Date()): IsoDate {
  return istDateParts.format(now); // en-CA gives YYYY-MM-DD
}

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Inclusive day count. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

export function monthStart(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export type PresetKey = "today" | "yesterday" | "last7" | "last30" | "mtd" | "lastMonth";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "mtd", label: "Month to date" },
  { key: "lastMonth", label: "Last month" },
];

export function presetRange(key: PresetKey, today: IsoDate = todayIST()): DateRange {
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "mtd":
      return { from: monthStart(today), to: today };
    case "lastMonth": {
      const lastDayPrev = addDays(monthStart(today), -1);
      return { from: monthStart(lastDayPrev), to: lastDayPrev };
    }
  }
}

/** Same-length window immediately before the given range (for period comparison). */
export function previousPeriod(r: DateRange): DateRange {
  const len = daysBetween(r.from, r.to);
  const to = addDays(r.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

/**
 * Parse ?from=&to= search params into a validated range. Invalid, reversed, future-only
 * or oversized input falls back to month-to-date (IST). Never throws.
 */
export function parseRange(
  params: { from?: string | string[]; to?: string | string[] },
  today: IsoDate = todayIST(),
): DateRange & { isDefault: boolean } {
  const f = Array.isArray(params.from) ? params.from[0] : params.from;
  const t = Array.isArray(params.to) ? params.to[0] : params.to;
  const fallback = { ...presetRange("mtd", today), isDefault: true };
  if (!isIsoDate(f) || !isIsoDate(t)) return fallback;
  if (f > t) return fallback;
  const to = t > today ? today : t;
  if (f > to) return fallback;
  if (daysBetween(f, to) > MAX_RANGE_DAYS) return fallback;
  return { from: f, to, isDefault: false };
}

/** 17 Oct 2026 */
export function formatDate(d: IsoDate): string {
  return isIsoDate(d) ? displayDate.format(new Date(`${d}T00:00:00Z`)) : "—";
}

/** 17 Oct */
export function formatDateShort(d: IsoDate): string {
  return isIsoDate(d) ? displayDateShort.format(new Date(`${d}T00:00:00Z`)) : "—";
}

/** 17 Oct, 10:15 IST — for timestamps such as data freshness. */
export function formatDateTimeIST(ts: string | Date | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return Number.isNaN(d.getTime()) ? "—" : `${displayDateTime.format(d)} IST`;
}

export function formatRange(r: DateRange): string {
  return r.from === r.to ? formatDate(r.from) : `${formatDateShort(r.from)} – ${formatDate(r.to)}`;
}
