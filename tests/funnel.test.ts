// App funnel math and action insights: per-stage conversion / drop-off / change, source separation, and insights
// that state their evidence, cause status and a sensitivity (never a fabricated uplift).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAfFunnel, buildFunnelSnapshot, buildStages, weakestStage } from "../lib/metrics/funnel.ts";
import { buildActionInsights, type InsightInput } from "../lib/metrics/actionInsights.ts";
import type { AfFunnelRow } from "../lib/types/schemas.ts";

const row = (stage: string, devices: number, users = devices): AfFunnelRow => ({ stage, events: devices, devices, users });

test("stage conversion, drop-off and change vs previous period", () => {
  const s = buildStages([
    { key: "a", label: "A", value: 1000, prev: 800 },
    { key: "b", label: "B", value: 250, prev: 240 },
    { key: "c", label: "C", value: 100, prev: 120 },
  ]);
  assert.equal(s[0].conv_prev, null);
  assert.equal(s[1].conv_prev, 0.25);
  assert.equal(s[1].drop, 750);
  assert.equal(s[1].drop_rate, 0.75);
  assert.equal(s[1].conv_prev_period, 0.3);
  assert.equal(s[2].change, (100 - 120) / 120);
  assert.equal(weakestStage(s.slice(1))?.key, "b");
});

const cur = [
  row("install", 9000), row("af_search", 7800), row("af_add_to_cart", 1800, 1760), row("af_initiated_checkout", 570),
  row("payment_attempted", 550), row("Payment_failed", 165), row("af_purchase", 480), row("First_Purchase", 350),
  row("atc_new_customer", 0, 1560), row("atc_repeat_customer", 0, 200), { stage: "atc_unidentified", events: 70, devices: null, users: null },
];

test("AppsFlyer funnel: derived payment stage, failure rate, new vs repeat cart split; no previous when not comparable", () => {
  const f = buildAfFunnel(cur, null);
  assert.deepEqual(f.stages.map((s) => s.key), ["install", "af_search", "af_add_to_cart", "af_initiated_checkout", "payment_attempted", "af_purchase", "First_Purchase"]);
  assert.equal(f.stages.find((s) => s.key === "payment_attempted")?.derived, true);
  assert.equal(f.paymentFailed.rate, 165 / 550);
  assert.deepEqual([f.atc.newCustomer, f.atc.repeatCustomer, f.atc.unidentified], [1560, 200, 70]);
  assert.equal(f.comparable, false);
  assert.ok(f.stages.every((s) => s.change === null));
});

test("period snapshot: AppsFlyer per window, New Sales from Fresh daily orders, comparisons and their gaps", () => {
  const order = (order_date: string, channel: "APP" | "WEB", order_type: "Fresh" | "Repeat", orders: number) =>
    ({ order_date, channel, order_type, orders, unique_customers: 0, revenue: 0, completed_orders: 0, completed_revenue: 0, avg_patient_age: null });
  const rows = buildFunnelSnapshot(
    [
      { key: "today", from: "2026-10-19", to: "2026-10-19", cmpFrom: "2026-10-18", cmpTo: "2026-10-18", af: [], afCmp: null, noCmp: "day in progress" },
      { key: "last7", from: "2026-10-12", to: "2026-10-18", cmpFrom: "2026-10-05", cmpTo: "2026-10-11", af: cur, afCmp: [row("install", 4500)] },
      { key: "mtd", from: "2026-10-01", to: "2026-10-18", cmpFrom: "2026-09-01", cmpTo: "2026-09-18", af: null, afCmp: null, afNoCmp: "before AppsFlyer data" },
    ],
    [order("2026-10-19", "APP", "Fresh", 5), order("2026-10-19", "WEB", "Fresh", 2), order("2026-10-19", "APP", "Repeat", 9), order("2026-10-15", "APP", "Fresh", 40), order("2026-09-10", "WEB", "Fresh", 30)],
  );
  const get = (k: string) => rows.find((r) => r.key === k)!;
  assert.deepEqual(get("install").cells.map((c) => c.value), [0, 9000, null]);
  assert.deepEqual(get("install").cells.map((c) => c.cmp), [null, 4500, null]);
  assert.deepEqual(get("install").cells.map((c) => c.noCmp), ["day in progress", null, "before AppsFlyer data"]);
  assert.equal(get("atc_new").cells[1].value, 1560);
  assert.deepEqual(get("new_sales").cells.map((c) => c.value), [7, 40, 40]);
  // Orders exist before AppsFlyer coverage, so New Sales keep their MTD comparison.
  assert.deepEqual(get("new_sales").cells.map((c) => [c.cmp, c.noCmp]), [[0, "day in progress"], [0, null], [30, null]]);
});

const base: InsightInput = {
  sales: { orders: 900, app: 600, web: 300, customers: 860, revenue: 430000 },
  salesPrev: { orders: 1050, app: 740, web: 310, customers: 990, revenue: 500000 },
  spend: null,
  spendPrev: null,
  metaConnected: false,
  af: null,
  afCoverageNote: null,
  ga4Connected: false,
  ga4Incomplete: false,
};

test("insights: tracking gaps are separate from performance and ranked first", () => {
  const ins = buildActionInsights(base);
  assert.equal(ins[0].id, "meta-not-connected");
  assert.equal(ins[0].kind, "tracking");
  assert.ok(ins.some((i) => i.id === "ga4-not-connected" && i.kind === "tracking"));
  const sales = ins.find((i) => i.id === "new-sales-change")!;
  assert.equal(sales.kind, "performance");
  assert.match(sales.title, /fell 14%/);
  assert.ok(sales.causes.some((c) => c.status === "confirmed" && /APP/.test(c.text))); // APP drove the drop (−140 vs −10)
  assert.ok(sales.causes.some((c) => c.status === "hypothesis"));
});

test("insights: funnel problems carry evidence, levers, an action and a labelled sensitivity", () => {
  const f = buildAfFunnel(cur, null);
  const ins = buildActionInsights({ ...base, af: { stages: f.stages, paymentFailed: f.paymentFailed, atcNew: 1560, atcRepeat: 200, comparable: false } });
  const pay = ins.find((i) => i.id === "payment-failures")!;
  assert.equal(pay.priority, 1); // 30% failure rate
  assert.match(pay.impact, /Sensitivity, not a forecast/);
  const drop = ins.find((i) => i.id.startsWith("stage-drop-"))!;
  assert.equal(drop.id, "stage-drop-af_add_to_cart"); // search → add to cart loses the most devices
  assert.ok(drop.evidence.length && drop.levers.length && drop.action && drop.followUp);
  assert.ok(drop.causes.every((c) => c.status === "hypothesis"));
  // Tracked first purchases are compared with business New Sales (APP), never substituted for them.
  assert.ok(ins.some((i) => i.id === "tracking-vs-business"));
});

test("insights: CAC change is decomposed into spend vs orders when Meta is connected", () => {
  const ins = buildActionInsights({ ...base, metaConnected: true, spend: 450000, spendPrev: 420000 });
  const cac = ins.find((i) => i.id === "cac-change")!;
  assert.match(cac.title, /rose/);
  assert.match(cac.affects, /all campaigns/);
  assert.equal(cac.causes[0].status, "confirmed");
});
