// Spend is grouped by the location in the ad set name, and "new" pincodes / areas mean the first-ever eligible Fresh
// order, judged over the whole history passed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateNewMarkets, type GeoOrder } from "../lib/geo/aggregate.ts";
import { buildSpendByTargeting, targetingOf } from "../lib/metrics/regionalInsights.ts";
import type { MetaAdDailyRow } from "../lib/types/schemas.ts";

test("ad set names map to the targeted location", () => {
  assert.equal(targetingOf("Meta_APP_ABO_TOFU_Creative_Test_All_22+_Mix_Mum_140726", null), "mumbai");
  assert.equal(targetingOf("Meta_APP_ABO_Creative_Test_Mumbai_Focused-061026", null), "mumbai");
  assert.equal(targetingOf("Meta_APP_CBO_MutliAds_Content_Mix_Metro_170926", null), "metros");
  assert.equal(targetingOf("Meta_App_ABO_T1_Cities_041026", null), "metros");
  assert.equal(targetingOf("Meta_APP_ABO_TOFU_Search_All_22+_MH_190826", null), "maharashtra");
  assert.equal(targetingOf("Meta_APP_ABO_Set33_Marathi_Apixaban_081026", null), "maharashtra");
  assert.equal(targetingOf("Meta_APP_ABO_UGC-3-061026", "MI_AKIDHA_Meta_APP_ABO_Creative_Test_220926"), "broad");
  assert.equal(targetingOf("APP_CATALOGUE_RTG", "MI_AKIDHA_Meta_APP_RTG_CBO_Content_260726"), "broad");
  // Words that merely contain the letters are not locations.
  assert.equal(targetingOf("Meta_APP_Summary_Ads", null), "broad");
  // Campaign name is the fallback.
  assert.equal(targetingOf("Adset_1", "MI_AKIDHA_Meta_App_ABO_T1_Content_041026"), "metros");
});

test("spend shares add up and ignore zero-spend rows", () => {
  const r = (adset: string, spend: number): MetaAdDailyRow => ({
    date: "2026-10-01", campaign_id: "c", campaign_name: "C", adset_id: adset, adset_name: adset, ad_id: adset, ad_name: "a",
    spend, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, installs: 0,
  });
  const rows = buildSpendByTargeting([r("X_Mum_1", 300), r("X_Metro_1", 100), r("X_UGC", 600), r("X_MH", 0)], [r("X_Mum_1", 500), r("X_UGC", 500)]);
  const by = Object.fromEntries(rows.map((x) => [x.group, x]));
  assert.equal(by.mumbai.share, 0.3);
  assert.equal(by.broad.share, 0.6);
  assert.equal(by.maharashtra.ad_sets, 0);
  assert.ok(Math.abs(by.mumbai.share_change! - -0.2) < 1e-9);
  assert.ok(Math.abs(rows.reduce((s, x) => s + (x.share ?? 0), 0) - 1) < 1e-9);
});

test("new markets: first-ever eligible order per pincode and district", () => {
  let id = 0;
  const o = (date: string, pin: string, status = "COMPLETED"): GeoOrder => ({ orderId: String(++id), userId: `u${id}`, date, platform: "APP", amount: 100, pin, city: "", status });
  const history = [
    o("2026-09-01", "413512"), // Tier 3 district 413 seen before the range
    o("2026-10-02", "413513"), // new pincode, old district
    o("2026-10-02", "413513"),
    o("2026-10-03", "845401"), // new pincode and new district
    o("2026-10-03", "799001", "DELIVERY_CANCELED"), // cancelled orders never make a place "new"
    o("2026-10-04", "400050"), // priority Mumbai, first order in range
    o("2026-09-15", "400051"), // priority, ordered before only
  ];
  const out = aggregateNewMarkets(history, "2026-10-01", "2026-10-05");
  const range = (t: string) => out.find((r) => r.level === "range" && r.group === t)!;
  assert.equal(range("tier_3").new_pins, 2);
  assert.equal(range("tier_3").new_areas, 1);
  assert.equal(range("tier_3").orders, 3);
  assert.equal(range("tier_3").active_pins, 2);
  assert.equal(range("tier_3").ever_pins, 3);
  assert.equal(range("priority_mumbai").new_pins, 1);
  assert.equal(range("priority_mumbai").active_pins, 1);
  assert.equal(range("priority_mumbai").ever_pins, 2);
  const day = out.find((r) => r.level === "daily" && r.key === "2026-10-03" && r.group === "tier_3")!;
  assert.deepEqual([day.new_pins, day.new_areas, day.orders], [1, 1, 1]);
  const areas = out.filter((r) => r.level === "area");
  assert.equal(areas.length, 1);
  assert.equal(areas[0].first_date, "2026-10-03");
  // Only aggregates: no field carries a pincode.
  for (const r of out) assert.ok(!/^\d{6}$/.test(r.key), r.key);
});
