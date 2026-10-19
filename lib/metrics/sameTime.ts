// Same-time-of-day comparison windows (War Room and Meta Ads). Pure (only ../format/ist.ts).
//
// "Now" is today up to the current IST minute. Every other window is counted to the SAME minute of its own days, so
// 10:00 today is compared with 10:00 yesterday, the average of the last 7 days to 10:00, and the average of this
// month's earlier days to 10:00 — never with full days. Multi-day windows are per-day averages so they sit on the
// same scale as today.

import { addDays, formatDateShort, monthStart } from "../format/ist.ts";

export type SameTimeId = "now" | "yday" | "l7" | "mtd";

export interface SameTimeWindow {
  id: SameTimeId;
  /** Column heading. */
  short: string;
  /** Dates and cut-off, e.g. "12 – 18 Oct · avg/day to 10:00". */
  span: string;
  /** What the column is compared with (column tooltip). */
  cmpLabel: string;
  /** Days counted (to the cut-off) — empty for MTD on the 1st of the month. */
  days: string[];
}

const daysFrom = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** First day any same-time window needs: the earlier of 7 days back and the start of the month. */
export function sameTimeFrom(today: string): string {
  const l7 = addDays(today, -7);
  const m = monthStart(today);
  return m < l7 ? m : l7;
}

/** `hhmm` = the cut-off shown to the reader, e.g. "10:00". */
export function sameTimeWindows(today: string, hhmm: string): SameTimeWindow[] {
  const yday = addDays(today, -1);
  const span = (f: string, t: string) => (f === t ? formatDateShort(f) : `${formatDateShort(f)} – ${formatDateShort(t)}`);
  const mtd = monthStart(today) <= yday ? daysFrom(monthStart(today), yday) : [];
  const cmp = (what: string) => `Now vs ${what}, both counted to ${hhmm} IST`;
  return [
    { id: "now", short: "Now", span: `${formatDateShort(today)} · to ${hhmm}`, cmpLabel: `Today so far, to ${hhmm} IST`, days: [today] },
    { id: "yday", short: "Yesterday", span: `${formatDateShort(yday)} · to ${hhmm}`, cmpLabel: cmp("yesterday"), days: [yday] },
    { id: "l7", short: "Last 7 days", span: `${span(addDays(today, -7), yday)} · avg/day to ${hhmm}`, cmpLabel: cmp("the last-7-day average"), days: daysFrom(addDays(today, -7), yday) },
    {
      id: "mtd",
      short: "MTD",
      span: mtd.length ? `${span(mtd[0], yday)} · avg/day to ${hhmm}` : "no earlier days this month",
      cmpLabel: cmp("the month-to-date average"),
      days: mtd,
    },
  ];
}

/** Per-day average of `get` over the window's days on or after `since` (source coverage); null when none is covered. */
export function avgOver(days: readonly string[], get: (day: string) => number, since = ""): number | null {
  const covered = days.filter((d) => d >= since);
  return covered.length ? covered.reduce((a, d) => a + get(d), 0) / covered.length : null;
}

/** Σnum ÷ Σden over the window's covered days — a rate for the window, not an average of daily rates. */
export function ratioOver(days: readonly string[], num: (day: string) => number, den: (day: string) => number, since = ""): number | null {
  const covered = days.filter((d) => d >= since);
  const n = covered.reduce((a, d) => a + num(d), 0);
  const dd = covered.reduce((a, d) => a + den(d), 0);
  return covered.length && dd ? n / dd : null;
}

export const NO_EARLIER_DAYS = "no earlier days this month";
