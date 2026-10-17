// India-oriented number formatting. Pure functions: safe on server and client.
// Indian digit grouping (12,34,567) comes from the en-IN locale.

const NBSP = " ";

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const countFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function isNum(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** ₹12,34,567 (no decimals). Returns an em dash for null / NaN. */
export function formatINR(n: number | null | undefined): string {
  return isNum(n) ? inrWhole.format(n) : "—";
}

/** ₹1,234.50 — for unit costs such as CPC where paise matter. */
export function formatINRPrecise(n: number | null | undefined): string {
  return isNum(n) ? inrPaise.format(n) : "—";
}

/** Compact Indian units: ₹950, ₹12.4K, ₹12.06 L, ₹1.25 Cr. */
export function formatINRCompact(n: number | null | undefined): string {
  if (!isNum(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}${NBSP}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}${NBSP}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** 12,34,567 */
export function formatCount(n: number | null | undefined): string {
  return isNum(n) ? countFmt.format(n) : "—";
}

/** Compact count: 950, 12.4K, 12.06 L, 1.25 Cr. */
export function formatCountCompact(n: number | null | undefined): string {
  if (!isNum(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${trim(a / 1e7)}${NBSP}Cr`;
  if (a >= 1e5) return `${sign}${trim(a / 1e5)}${NBSP}L`;
  if (a >= 1e3) return `${sign}${trim(a / 1e3)}K`;
  return `${sign}${Math.round(a)}`;
}

/** Ratio (0.1234) → "12.3%". */
export function formatPct(ratio: number | null | undefined, digits = 1): string {
  return isNum(ratio) ? `${(ratio * 100).toFixed(digits)}%` : "—";
}

/** Change between two values as a signed percentage, or null if not computable. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Safe division: null when the denominator is zero or missing. Never Infinity. */
export function safeDiv(num: number | null | undefined, den: number | null | undefined): number | null {
  if (!isNum(num) || !isNum(den) || den === 0) return null;
  return num / den;
}

function trim(x: number): string {
  const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
