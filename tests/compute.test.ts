import { test } from "node:test";
import assert from "node:assert/strict";
import { acquisitionCosts, summarizeFresh, summarizeMeta, summarizeRegions } from "../lib/metrics/compute.ts";
import type { OrdersDailyRow, RegionDailyRow } from "../lib/types/schemas.ts";

// Synthetic fixtures for arithmetic only — never rendered.
const o = (channel: OrdersDailyRow["channel"], order_type: OrdersDailyRow["order_type"], orders: number, revenue: number): OrdersDailyRow => ({
  order_date: "2026-01-01", channel, order_type, orders, unique_customers: orders, revenue,
  completed_orders: 0, completed_revenue: 0, avg_patient_age: null,
});

test("summarizeFresh counts Fresh only and splits channels", () => {
  const s = summarizeFresh([o("APP", "Fresh", 3, 300), o("WEB_AGENT", "Fresh", 2, 400), o("WEB_OTHER", "Fresh", 1, 100), o("APP", "Repeat", 9, 900)]);
  assert.equal(s.fresh_orders, 6);
  assert.equal(s.fresh_app, 3);
  assert.equal(s.fresh_web_agent, 2);
  assert.equal(s.fresh_web_other, 1);
  assert.equal(s.fresh_revenue, 800);
  assert.equal(s.aov_fresh, 800 / 6);
});

test("CAC uses Fresh orders; cost per customer uses unique customers", () => {
  const a = acquisitionCosts(1000, 4, 2);
  assert.equal(a.cac_fresh_order, 250);
  assert.equal(a.cost_per_new_customer, 500);
  assert.equal(acquisitionCosts(1000, 0, 0).cac_fresh_order, null);
  assert.equal(acquisitionCosts(null, 4, 2).cac_fresh_order, null);
});

test("summarizeMeta derives CPM/CTR/CPC/CPI from totals, not averages of days", () => {
  const s = summarizeMeta([
    { date: "2026-01-01", spend: 100, impressions: 1000, clicks: 20, link_clicks: 10, installs: 1 },
    { date: "2026-01-02", spend: 300, impressions: 1000, clicks: 20, link_clicks: 30, installs: 3 },
  ]);
  assert.equal(s.cpm, 200);
  assert.equal(s.ctr, 0.02);
  assert.equal(s.cpc, 10);
  assert.equal(s.cpi, 100);
});

test("region shares reconcile to 100% including Unmapped", () => {
  const r = (region: string, n: number): RegionDailyRow => ({
    order_date: "2026-01-01", region, channel: "APP", fresh_orders: n, fresh_revenue: n * 10, completed_fresh_revenue: 0,
  });
  const s = summarizeRegions([r("NCR", 2), r("Unmapped", 6), r("Mumbai Belt", 2)]);
  const share = s.reduce((a, x) => a + (x.order_share ?? 0), 0);
  assert.ok(Math.abs(share - 1) < 1e-9);
  assert.equal(s[0].region, "Unmapped");
});
