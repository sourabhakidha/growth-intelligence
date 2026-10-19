import { test } from "node:test";
import assert from "node:assert/strict";
import { avgOver, ratioOver, sameTimeFrom, sameTimeWindows } from "../lib/metrics/sameTime.ts";
import { sameTimeFacts } from "../lib/metrics/metaFresh.ts";
import type { MetaAfRow, MetaSameTimeRow } from "../lib/types/schemas.ts";

test("same-time windows: now, yesterday, 7 days before today, month to yesterday", () => {
  const [now, yday, l7, mtd] = sameTimeWindows("2026-10-19", "10:00");
  assert.deepEqual(now.days, ["2026-10-19"]);
  assert.deepEqual(yday.days, ["2026-10-18"]);
  assert.deepEqual(l7.days, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.equal(mtd.days[0], "2026-10-01");
  assert.equal(mtd.days.at(-1), "2026-10-18");
  assert.equal(mtd.days.length, 18);
  assert.match(l7.span, /avg\/day to 10:00/);
  assert.equal(sameTimeFrom("2026-10-19"), "2026-10-01");
  assert.equal(sameTimeFrom("2026-10-03"), "2026-09-26");
});

test("MTD on the 1st has no earlier days", () => {
  const mtd = sameTimeWindows("2026-11-01", "09:30")[3];
  assert.deepEqual(mtd.days, []);
});

test("averages and rates skip days before a source's coverage", () => {
  const v: Record<string, number> = { "2026-10-04": 0, "2026-10-05": 0, "2026-10-06": 10, "2026-10-07": 20 };
  const days = Object.keys(v);
  assert.equal(avgOver(days, (d) => v[d]), 7.5);
  assert.equal(avgOver(days, (d) => v[d], "2026-10-06"), 15);
  assert.equal(avgOver(days, (d) => v[d], "2026-11-01"), null);
  // Σnum ÷ Σden, not the mean of daily rates.
  assert.equal(ratioOver(["a", "b"], (d) => (d === "a" ? 1 : 9), (d) => (d === "a" ? 10 : 10)), 0.5);
  assert.equal(ratioOver(["a"], () => 1, () => 0), null);
});

const row = (day: string, spend: number, sales: number): MetaSameTimeRow => ({
  day, meta_minute: 600, spend, impressions: spend * 100, clicks: spend, link_clicks: spend / 2, installs: spend / 10, video_3s: 0,
  new_sales: sales, new_sales_app: sales, fresh_customers: sales, fresh_leads: sales,
});
const st = (day: string, n: number): MetaAfRow => ({
  level: "st", key: day, installs: n, atc: n, atc_fresh: n, checkout_fresh: n, fresh_orders: n, fresh_orders_app: n, fresh_customers: n, atc_fresh_buyers: n,
});

test("same-time facts are per-day averages; AppsFlyer averages over covered days with spend on those days", () => {
  const rows = [row("2026-10-05", 1000, 10), row("2026-10-06", 2000, 20), row("2026-10-07", 3000, 30)];
  // A whole-window row must not be mistaken for a same-time day.
  const af = [st("2026-10-06", 20), st("2026-10-07", 40), { ...st("2026-10-05", 999), level: "window" as const }];
  const f = sameTimeFacts(rows, af, ["2026-10-05", "2026-10-06", "2026-10-07"])!;
  assert.equal(f.meta.spend, 2000);
  assert.equal(f.newSales, 20);
  assert.equal(f.meta.cpi, 10);
  assert.equal(f.af?.atc_fresh, 30);
  assert.equal(f.afSpend, 2500);
  assert.deepEqual(f.afWindow, { from: "2026-10-06", to: "2026-10-07" });
  assert.equal(sameTimeFacts(rows, af, ["2026-09-01"]), null);
  assert.equal(sameTimeFacts(rows, null, ["2026-10-07"])!.af, null);
});
