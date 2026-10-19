// Pure helpers used by lib/db/queries.ts to reproduce the reporting SQL (lib/sql/*.sql) in TypeScript.
// No imports, so node --test can exercise them directly.

export type OrderChannelValue = "APP" | "WEB";

/** IST is a fixed UTC+05:30 offset (no DST). */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * APP = self-serve app orders; WEB = sales-assisted orders within the app business (not website-acquired customers).
 * WEB is never split into agent / non-agent. Callers only pass orders already filtered to APP or WEB.
 */
export function channelOf(orderPlatform: unknown): OrderChannelValue {
  return orderPlatform === "APP" ? "APP" : "WEB";
}

export function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** `$1::date::timestamp at time zone 'Asia/Kolkata'` — the instant an IST calendar day starts. */
export function istDayStart(d: string): string {
  return `${d}T00:00:00+05:30`;
}

/** `(ts at time zone 'Asia/Kolkata')::date` for a timestamptz value. */
export function istDateOfInstant(ts: string): string {
  return new Date(Date.parse(ts) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `"orderDate" at time zone 'Asia/Kolkata'` — orderDate is IST wall-clock time without a zone. Returns epoch ms. */
export function istWallClockToEpoch(wallClock: string): number {
  return Date.parse(`${wallClock.slice(0, 19)}+05:30`);
}

/** `"orderDate"::date` for a timestamp-without-time-zone value. */
export function wallClockDate(wallClock: string): string {
  return wallClock.slice(0, 10);
}

/** Postgres trim() removes spaces only. */
export function pgTrim(s: string): string {
  return s.replace(/^ +| +$/g, "");
}

/** Postgres round(x, 1) for numerics: half away from zero. */
export function round1(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) * 10) / 10;
}

/** Rounds away floating-point noise from summed currency values. */
export function money(x: number): number {
  return Math.round(x * 100) / 100;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** sum() ignoring nulls; null when every input is null (Postgres semantics). */
export function sumOrNull(values: readonly unknown[]): number | null {
  let total = 0;
  let seen = false;
  for (const v of values) {
    const n = toNum(v);
    if (n === null) continue;
    total += n;
    seen = true;
  }
  return seen ? total : null;
}

/** percentile_cont(0.5) ignoring nulls; null for no input. */
export function median(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const pos = (xs.length - 1) / 2;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const bucket = out.get(k);
    if (bucket) bucket.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** count(distinct x): nulls (and, with blankIsNull, empty strings) are not counted. */
export function countDistinct(values: readonly unknown[], blankIsNull = false): number {
  const s = new Set<unknown>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (blankIsNull && v === "") continue;
    s.add(v);
  }
  return s.size;
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending comparator over several keys (strings or numbers). */
export function byKeys<T>(...keys: ((r: T) => string | number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of keys) {
      const x = k(a);
      const y = k(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : compareText(String(x), String(y));
      if (c !== 0) return c;
    }
    return 0;
  };
}

/**
 * `select distinct on (phone, d) ... order by phone, d, created_at, id` — keeps the earliest lead per phone per
 * IST date. Null phones form one group, as in Postgres DISTINCT ON.
 */
export function firstLeadPerPhonePerDay<T extends { phone: string | null; d: string; createdMs: number; id: number }>(
  rows: readonly T[],
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.phone ?? "\u0000"}|${r.d}`;
    const cur = best.get(k);
    if (!cur || r.createdMs < cur.createdMs || (r.createdMs === cur.createdMs && r.id < cur.id)) best.set(k, r);
  }
  return [...best.values()];
}

/** Written crm_025a lead filter: drop recycled re-runs ('#r' in source_ref) and duplicate-merged leads. */
export function isCountableCartLead(sourceRef: string | null, closedWhy: string | null): boolean {
  return !(sourceRef ?? "").includes("#r") && closedWhy !== "duplicate_merged";
}
