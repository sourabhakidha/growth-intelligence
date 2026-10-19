// AOV intelligence: brackets never overlap and cover every order once, AOV is Σ revenue ÷ Σ orders of the same slice,
// and the mix / basket-size split adds up exactly to the AOV change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketMix, bracketOf, breakdown, dailyAov, windowAgg } from "../lib/metrics/aov.ts";
import type { AovFreshRow } from "../lib/types/schemas.ts";

test("bracket boundaries: lower inclusive, upper exclusive, missing amount separate", () => {
  assert.equal(bracketOf(0), "b0_100");
  assert.equal(bracketOf(99.99), "b0_100");
  assert.equal(bracketOf(100), "b100_200");
  assert.equal(bracketOf(199.99), "b100_200");
  assert.equal(bracketOf(200), "b200_500");
  assert.equal(bracketOf(499.99), "b200_500");
  assert.equal(bracketOf(500), "b500_600");
  assert.equal(bracketOf(599.99), "b500_600");
  assert.equal(bracketOf(600), "b600_plus");
  assert.equal(bracketOf(12684.52), "b600_plus");
  assert.equal(bracketOf(null), "no_amount");
});

const r = (order_date: string, channel: "APP" | "WEB", region: AovFreshRow["region"], bracket: AovFreshRow["bracket"], orders: number, revenue: number, payment_mode = "CASH"): AovFreshRow => ({
  order_date, channel, payment_mode, region, bracket, orders, revenue,
});
const rows: AovFreshRow[] = [
  // previous: 10 APP @ 300, 10 WEB @ 700
  r("2026-10-01", "APP", "tier_3", "b200_500", 10, 3000),
  r("2026-10-01", "WEB", "priority_mumbai", "b600_plus", 10, 7000),
  // current: 30 APP @ 250, 10 WEB @ 800, 2 orders without amount
  r("2026-10-08", "APP", "tier_3", "b200_500", 30, 7500),
  r("2026-10-08", "WEB", "priority_mumbai", "b600_plus", 10, 8000),
  r("2026-10-08", "APP", "unverified", "no_amount", 2, 0),
];
const cur = { from: "2026-10-08", to: "2026-10-08" };
const prev = { from: "2026-10-01", to: "2026-10-01" };

test("AOV = Σ revenue ÷ Σ orders, missing amounts count as orders", () => {
  const a = windowAgg(rows, cur.from, cur.to);
  assert.equal(a.orders, 42);
  assert.ok(Math.abs(a.aov! - 15500 / 42) < 1e-9);
});

test("bracket shares add to 100% and every order is counted once", () => {
  const b = bracketMix(rows, cur, prev);
  assert.equal(b.reduce((s, x) => s + x.orders, 0), 42);
  assert.ok(Math.abs(b.reduce((s, x) => s + (x.order_share ?? 0), 0) - 1) < 1e-9);
  assert.ok(Math.abs(b.reduce((s, x) => s + (x.revenue_share ?? 0), 0) - 1) < 1e-9);
  assert.ok(b.some((x) => x.bracket === "no_amount" && x.orders === 2));
});

test("mix + basket effects add up exactly to the AOV change, for every dimension", () => {
  for (const dim of ["channel", "payment_mode", "region"] as const) {
    const b = breakdown(rows, dim, cur, prev);
    const d = b.total.aov! - b.totalPrev!.aov!;
    assert.ok(Math.abs(b.mix! + b.rate! - d) < 1e-6, `${dim}: ${b.mix} + ${b.rate} ≠ ${d}`);
  }
  const ch = breakdown(rows, "channel", cur, prev);
  assert.ok(ch.mix! < 0, "more APP orders (lower AOV) pulls AOV down through mix");
});

test("trailing 7-day AOV is Σ revenue ÷ Σ orders of the window", () => {
  const dates = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
  const d = dailyAov([r("2026-10-02", "APP", "tier_1", "b200_500", 1, 300), r("2026-10-08", "APP", "tier_1", "b600_plus", 3, 2100)], dates);
  assert.equal(d.at(-1)!.aov_7d, Math.round(2400 / 4));
  assert.equal(d[0].aov_7d, null);
});
