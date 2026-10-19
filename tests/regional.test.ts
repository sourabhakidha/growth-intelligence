// Regional hierarchy and aggregation must follow the agreed rules: exclusive tiers, distinct orders and customers,
// AOV = revenue ÷ orders at the same level, small-pincode suppression, and no unknown location labelled Tier 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIORITY_MUMBAI_PINCODES, resolveLocation } from "../lib/geo/regions.ts";
import { aggregatePeriods, aggregateRegional, SUPPRESSED_PINCODES_KEY, type GeoOrder } from "../lib/geo/aggregate.ts";
import { periodSpecs } from "../lib/format/periods.ts";
import { buildPeriodView, buildRegionalView } from "../lib/metrics/regional.ts";
import type { RegionalRow } from "../lib/types/schemas.ts";

test("priority list is kept exactly as supplied", () => {
  assert.equal(PRIORITY_MUMBAI_PINCODES.size, 200);
  for (const p of ["400000", "400001", "421507", "989898", "999992"]) assert.ok(PRIORITY_MUMBAI_PINCODES.has(p), p);
  assert.ok(!PRIORITY_MUMBAI_PINCODES.has("400045"));
});

test("hierarchy is first-match and exclusive", () => {
  const tier = (pin: string, city = "") => resolveLocation(pin, city).tier;
  const area = (pin: string, city = "") => resolveLocation(pin, city).area;
  // Priority Mumbai pincodes first
  assert.equal(tier("400050"), "priority_mumbai");
  assert.equal(tier("989898"), "priority_mumbai"); // non-standard but on the supplied list
  assert.equal(tier("401101"), "priority_mumbai"); // Mira-Bhayandar pincode on the list
  // Tier 1: rest of MMR + Pune, Kolkata, Hyderabad, Ahmedabad, Chennai, Bangalore, Surat
  for (const pin of ["400045", "421308", "410221", "401103"]) assert.equal(tier(pin), "tier_1", pin);
  assert.equal(resolveLocation("400045", "").market, "mumbai");
  assert.equal(area("401103"), "Mira-Bhayandar");
  assert.equal(area("411001", "Pune"), "Pune");
  assert.equal(area("411019", "Pimpri-Chinchwad"), "Pimpri-Chinchwad");
  assert.equal(area("700019", "kolkata"), "Kolkata");
  assert.equal(area("711101", "Howrah"), "Howrah");
  assert.equal(area("500003", "Secunderabad"), "Secunderabad");
  assert.equal(area("500081", "hyderabad"), "Hyderabad");
  assert.equal(area("380015", "ahmedabad"), "Ahmedabad");
  assert.equal(area("382210", "Ahmedabad"), "Ahmedabad");
  assert.equal(area("600040", "chennai"), "Chennai");
  assert.equal(tier("560001", "bangalore"), "tier_1");
  assert.equal(tier("395007", "surat"), "tier_1");
  assert.equal(resolveLocation("560001", "bangalore").market, "other_metros");
  // Delhi NCR stays its own group
  assert.equal(tier("110017"), "delhi_ncr");
  assert.equal(area("201301", "noida"), "Noida & Greater Noida");
  assert.equal(area("203207", "greater noida"), "Noida & Greater Noida");
  assert.equal(area("121002", "faridabad"), "Faridabad");
  // Tier 2: established Tier 2 cities
  for (const [pin, city, name] of [
    ["462001", "", "Bhopal"], ["452001", "", "Indore"], ["226010", "", "Lucknow"], ["160017", "", "Chandigarh"],
    ["530017", "visakhapatnam", "Visakhapatnam"], ["416003", "kolhapur", "Kolhapur"], ["416416", "sangli", "Sangli"],
    ["415001", "satara", "Satara"], ["431001", "aurangabad", "Aurangabad"], ["302001", "", "Jaipur"], ["440010", "", "Nagpur"],
    ["641018", "coimbatore", "Coimbatore"], ["403001", "goa", "Goa"],
  ] as const) {
    assert.equal(tier(pin, city), "tier_2", `${pin} ${city}`);
    assert.equal(area(pin, city), name);
  }
  assert.equal(tier("824101", "aurangabad"), "tier_3"); // Aurangabad, Bihar — wrong postal circle for the Tier 2 city
  // Tier 3: everything else with a valid pincode
  assert.equal(tier("410506"), "tier_3"); // Pune district (Talegaon), not MMR or Pune city
  assert.equal(tier("562106", "anekal"), "tier_3");
  assert.equal(tier("160062", "mohali"), "tier_3");
  assert.equal(tier("382010", "gandhinagar"), "tier_3");
  for (const [pin, city] of [["414001", "ahmednagar"], ["444001", "akola"], ["442401", "chandrapur"], ["443001", "buldhana"],
    ["415612", "ratnagiri"], ["424001", "dhule"], ["413512", "latur"], ["313001", "udaipur"]] as const) {
    assert.equal(tier(pin, city), "tier_2", city);
  }
  assert.equal(tier("799120", "udaipur"), "tier_3"); // Udaipur, Tripura — not the Rajasthan city
  assert.equal(tier("413501", "osmanabad"), "tier_3");
  assert.equal(tier("416115", "ichalkaranji"), "tier_3"); // Kolhapur district periphery
});

test("unknown locations are never Tier 3", () => {
  for (const pin of ["", null, "12345", "0400001", "9xx", "999999", "abcdef"]) {
    assert.equal(resolveLocation(pin, "Mumbai").tier, "unverified", String(pin));
  }
});

const o = (
  orderId: string, userId: string | null, pin: string, platform: "APP" | "WEB", amount: number,
  date = "2026-10-01", city = "", status = "COMPLETED",
): GeoOrder => ({ orderId, userId, date, platform, amount, pin, city, status });

test("aggregation counts distinct orders and customers and reconciles across tiers", () => {
  const rows = aggregateRegional([
    o("A", "u1", "400050", "APP", 100),
    o("A", "u1", "400050", "APP", 100), // duplicate source row — must not count twice
    o("B", "u1", "400050", "WEB", 300),
    o("C", "u2", "400050", "APP", 200),
    o("D", "u3", "400050", "APP", 200, "2026-10-02"),
    o("E", "u1", "110017", "WEB", 500), // same customer in another tier
    o("F", "u4", "413501", "APP", 50, "2026-10-01", "osmanabad"),
    o("G", "u5", "", "APP", 70),
  ]) as RegionalRow[];
  const get = (level: string, key: string) => rows.find((r) => r.level === level && r.key === key)!;
  const total = get("total", "All Fresh orders");
  assert.equal(total.fresh_orders, 7);
  assert.equal(total.customers, 5);
  assert.equal(total.revenue, 1420);
  const tiers = rows.filter((r) => r.level === "tier");
  assert.equal(tiers.reduce((a, r) => a + r.fresh_orders, 0), total.fresh_orders);
  assert.equal(Math.round(tiers.reduce((a, r) => a + r.revenue, 0)), total.revenue);
  const pr = rows.find((r) => r.level === "tier" && r.group === "priority_mumbai")!;
  assert.deepEqual([pr.fresh_orders, pr.fresh_app, pr.fresh_web, pr.customers], [4, 3, 1, 3]);
  assert.ok(rows.some((r) => r.level === "area" && r.key === "Osmanabad area (413xxx)"));
  assert.ok(!rows.some((r) => r.level === "area" && r.group === "unverified"), "unverified orders are never listed by area");
});

test("priority pincodes with fewer than 3 customers are merged", () => {
  const rows = aggregateRegional([
    o("A", "u1", "400050", "APP", 100),
    o("B", "u2", "400050", "APP", 100),
    o("C", "u3", "400050", "APP", 100),
    o("D", "u4", "400051", "APP", 100),
    o("E", "u5", "400052", "WEB", 100),
  ]) as RegionalRow[];
  const pins = rows.filter((r) => r.level === "pincode");
  assert.deepEqual(pins.map((r) => r.key).sort(), ["400050", SUPPRESSED_PINCODES_KEY].sort());
  const merged = pins.find((r) => r.key === SUPPRESSED_PINCODES_KEY)!;
  assert.equal(merged.group_size, 2);
  assert.equal(merged.fresh_orders, 2);
  assert.ok(!pins.some((r) => r.key === "400051" || r.key === "400052"));
});

test("watch markets are flagged whenever they get orders", () => {
  const rows = aggregateRegional([
    o("A", "u1", "395007", "APP", 100, "2026-10-01", "surat"),
    o("B", "u2", "530017", "WEB", 200, "2026-10-01", "visakhapatnam"),
    o("C", "u3", "560001", "APP", 300, "2026-10-01", "bangalore"),
  ]) as RegionalRow[];
  const v = buildRegionalView(rows, null, ["2026-10-01"]);
  assert.deepEqual(v.watch.map((w) => w.key).sort(), ["Surat", "Visakhapatnam"]);
  assert.ok(v.insights.some((i) => i.kind === "watch" && i.text.startsWith("Surat")));
  assert.ok(v.markets.some((m) => m.group === "other_metros" && m.fresh_orders === 2)); // Bangalore + Surat
  assert.ok(v.markets.some((m) => m.group === "tier_2" && m.fresh_orders === 1)); // Visakhapatnam
  assert.equal(v.topMetros.find((m) => m.key === "Bangalore")?.group, "tier_1");
});

test("view AOV is revenue ÷ orders of the same row, never an average of AOVs", () => {
  const rows = aggregateRegional([
    o("A", "u1", "110017", "APP", 100, "2026-10-01"),
    o("B", "u2", "110017", "APP", 100, "2026-10-01"),
    o("C", "u3", "110017", "WEB", 1000, "2026-10-02"),
  ]) as RegionalRow[];
  const v = buildRegionalView(rows, null, ["2026-10-01", "2026-10-02"]);
  assert.equal(v.total?.aov, 400); // (100+100+1000)/3, not mean(100, 1000) = 550
  assert.equal(v.daily.length, 2);
  assert.equal(v.daily[0].delhi_ncr, 2);
  assert.equal(v.topMetros[0].key, "Delhi");
});

test("RTO and cancellations: cancelled orders stay out of new sales but count on the placed base", () => {
  const rows = aggregateRegional([
    o("A", "u1", "110017", "APP", 100, "2026-10-01", "", "COMPLETED"),
    o("B", "u2", "110017", "APP", 100, "2026-10-01", "", "RTO_DELIVERED"),
    o("C", "u3", "110017", "WEB", 100, "2026-10-01", "", "IN_TRANSIT"),
    o("D", "u4", "110017", "WEB", 900, "2026-10-01", "", "DELIVERY_CANCELED"), // excluded from new sales
    o("E", "u5", "110017", "APP", 100, "2026-10-01", "", "DR_REJECTED"), // eligible and NOT a cancellation
    o("F", "u6", "110017", "APP", 900, "2026-10-01", "", "PRESCRIPTION_UPLOADED"), // never passed in by the query, ignored if it is
  ]) as RegionalRow[];
  const t = rows.find((r) => r.level === "tier" && r.group === "delhi_ncr")!;
  assert.equal(t.fresh_orders, 4); // A, B, C, E
  assert.equal(t.revenue, 400);
  assert.equal(t.customers, 4);
  assert.equal(t.placed_orders, 6);
  assert.equal(t.cancelled_orders, 1); // D only
  assert.equal(t.delivered_orders, 1);
  assert.equal(t.rto_orders, 1);
  const v = buildRegionalView(rows, null, ["2026-10-01"]);
  assert.equal(v.tiers[0].rto_rate, 0.5); // 1 RTO ÷ (1 delivered + 1 RTO); in-transit excluded
  assert.equal(v.tiers[0].aov, 100);
});

test("period comparison follows the end date and uses complete days only", () => {
  const input = [
    o("A", "u1", "110017", "APP", 100, "2026-10-18"), // today, in progress
    o("B", "u2", "110017", "WEB", 200, "2026-10-17"),
    o("C", "u3", "400050", "APP", 300, "2026-10-12"),
    o("D", "u4", "400050", "APP", 400, "2026-10-11"),
    o("E", "u5", "400050", "APP", 500, "2026-10-02"),
  ];
  // End date = today (18 Oct): today so far; 7 days and MTD end yesterday.
  const live = periodSpecs("2026-10-18", "2026-10-18");
  assert.deepEqual(live.map((p) => [p.id, p.from, p.to, p.days, p.partial]), [
    ["day", "2026-10-18", "2026-10-18", 0, true],
    ["prev_day", "2026-10-17", "2026-10-17", 1, false],
    ["last7", "2026-10-11", "2026-10-17", 7, false],
    ["mtd", "2026-10-01", "2026-10-17", 17, false],
  ]);
  const pv = buildPeriodView(aggregatePeriods(input, live) as RegionalRow[], live);
  assert.deepEqual(pv.overall.map((p) => [p.period, p.fresh_orders, p.days, p.orders_per_day]), [
    ["day", 1, null, null], ["prev_day", 1, 1, 1], ["last7", 3, 7, 3 / 7], ["mtd", 4, 17, 4 / 17],
  ]);
  assert.equal(pv.perDayByTier.length, 3); // today-so-far is not charted as a daily pace
  // End date in the past (15 Oct): every period ends on 15 Oct.
  const past = periodSpecs("2026-10-15", "2026-10-18");
  assert.deepEqual(past.map((p) => [p.id, p.from, p.to, p.days]), [
    ["day", "2026-10-15", "2026-10-15", 1], ["prev_day", "2026-10-14", "2026-10-14", 1],
    ["last7", "2026-10-09", "2026-10-15", 7], ["mtd", "2026-10-01", "2026-10-15", 15],
  ]);
  const pp = buildPeriodView(aggregatePeriods(input, past) as RegionalRow[], past);
  assert.deepEqual(pp.overall.map((p) => p.fresh_orders), [0, 0, 2, 3]);
  assert.equal(pp.overall[3].aov, 400); // (300 + 400 + 500) / 3
  // On the 1st of the month while it is in progress, month to date has no complete days.
  const first = periodSpecs("2026-11-01", "2026-11-01");
  assert.equal(first[3].days, 0);
});
