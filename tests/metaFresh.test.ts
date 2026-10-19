// Meta → Fresh sales view-models: comparisons are only made where every source covers the window, the funnel's main
// path never grows from one step to the next, AppsFlyer gaps are null (never zero), and formats split out UGC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { afClip, campaignDrivers, formatOf, freshFunnel, kpiStrip, windowFacts, type AfWindow } from "../lib/metrics/metaFresh.ts";
import { metaPeriods, type Creative } from "../lib/metrics/metaIntel.ts";
import type { CartLeadDailyRow, MetaAdHistoryRow, OrdersDailyRow } from "../lib/types/schemas.ts";

const ad = (date: string, spend: number, installs: number, campaign = "C1"): MetaAdHistoryRow => ({
  date, campaign_id: campaign, campaign_name: campaign, adset_id: "s", adset_name: "S", ad_id: `${campaign}-a`, ad_name: "A",
  spend, impressions: spend * 10, reach: 0, frequency: 0, clicks: spend / 10, link_clicks: spend / 20, installs, video_3s: 0, thruplays: 0,
});
const af = (atc: number, buyers: number): AfWindow => ({ installs: 0, atc, atc_fresh: atc, checkout_fresh: 0, fresh_orders: buyers + 5, fresh_orders_app: buyers, fresh_customers: buyers, atc_fresh_buyers: buyers });
const orders: OrdersDailyRow[] = [
  { order_date: "2026-10-12", channel: "APP", order_type: "Fresh", orders: 10, unique_customers: 10, revenue: 0, completed_orders: 0, completed_revenue: 0, avg_patient_age: null },
  { order_date: "2026-10-12", channel: "WEB", order_type: "Fresh", orders: 4, unique_customers: 4, revenue: 0, completed_orders: 0, completed_revenue: 0, avg_patient_age: null },
  { order_date: "2026-10-12", channel: "APP", order_type: "Repeat", orders: 50, unique_customers: 50, revenue: 0, completed_orders: 0, completed_revenue: 0, avg_patient_age: null },
];
const leads: CartLeadDailyRow[] = [{ lead_date: "2026-10-12", total_cart_leads: 9, fresh: 6, repeat: 3 }];

test("AppsFlyer windows are clipped to coverage (6 Oct 2026)", () => {
  assert.deepEqual(afClip("2026-10-01", "2026-10-17"), { from: "2026-10-06", to: "2026-10-17" });
  assert.equal(afClip("2026-09-01", "2026-09-17"), null);
});

test("New Sales count Fresh orders only, APP + WEB; leads use the Fresh count", () => {
  const f = windowFacts([ad("2026-10-12", 1000, 10)], "2026-10-11", "2026-10-17", af(20, 4), leads, orders, 12);
  assert.equal(f.newSales, 14);
  assert.equal(f.newSalesApp, 10);
  assert.equal(f.leads, 6);
  assert.equal(f.afSpend, 1000);
});

test("MTD before Meta / AppsFlyer coverage is not compared", () => {
  const p = metaPeriods("2026-10-17", "2026-10-18").find((x) => x.id === "mtd")!; // compares with 1–17 Sep
  const hist = [ad("2026-09-15", 500, 5), ad("2026-10-12", 1000, 10)];
  const cur = windowFacts(hist, p.from, p.to, af(20, 4), leads, orders, 12);
  const cmp = windowFacts(hist, p.cmpFrom, p.cmpTo, null, leads, orders, 10);
  const t = Object.fromEntries(kpiStrip(p, cur, cmp).map((x) => [x.key, x]));
  assert.equal(t.fresh_cac.change, null); // partial September spend would understate the old CAC
  assert.equal(t.spend.change, null);
  assert.equal(t.fresh_atc.change, null);
  assert.equal(t.fresh_leads.change, null); // no CRM leads loaded for September
  assert.notEqual(t.cpi.change, null); // rates over covered days stay comparable
  assert.ok(cur.afWindow, "current MTD notes that AppsFlyer covers only part of it");
});

test("funnel main path is monotone: the order step is a subset of Fresh ATC users", () => {
  const cur = windowFacts([ad("2026-10-12", 1000, 50)], "2026-10-11", "2026-10-17", af(20, 4), leads, orders, 12);
  const v = freshFunnel({ from: "2026-10-11", to: "2026-10-17" }, null, cur, null);
  for (let i = 1; i < v.steps.length; i++) assert.ok((v.steps[i].value ?? 0) <= (v.steps[i - 1].value ?? 0), v.steps[i].key);
  assert.equal(v.steps.at(-1)!.key, "fresh_buyers");
  assert.equal(v.metaUserOrders, 9); // all Meta-user orders are context, not a step
});

test("campaign drivers: unreadable AppsFlyer report gives null, not zero", () => {
  const hist = [ad("2026-10-12", 1000, 10), ad("2026-10-05", 400, 4)];
  const [d] = campaignDrivers(hist, null, { from: "2026-10-11", to: "2026-10-17" }, { from: "2026-10-04", to: "2026-10-10" });
  assert.equal(d.spend_delta, 600);
  assert.equal(d.af_atc, null);
  assert.equal(d.cost_per_af_fp, null);
});

test("format split keeps UGC separate", () => {
  const c = (name: string, format: string, cohort: Creative["cohort"] = "pre_oct") => ({ name, format, cohort }) as Creative;
  assert.equal(formatOf(c("UGC 3", "Video")), "UGC video");
  assert.equal(formatOf(c("App_Video_Core", "Video", "oct")), "Brand video");
  assert.equal(formatOf(c("x", "Video (inferred)")), "Video (inferred)");
  assert.equal(formatOf(c("app_static_1", "Static", "oct")), "Static image");
});
