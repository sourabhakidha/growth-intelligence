// Meta Ads intelligence: comparable periods, partial-day handling, CPI decomposition, creative classification with
// sample-size guards, and no Meta-attributed purchases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseCreatives, changeSignal, metaInsights, metaPeriods, octCohort, periodBlocks, totals } from "../lib/metrics/metaIntel.ts";
import { OCT_CREATIVES, creativeOf } from "../lib/metrics/octCreatives.ts";
import { addDays } from "../lib/format/ist.ts";
import type { MetaAdHistoryRow, OrdersDailyRow } from "../lib/types/schemas.ts";

const ad = (date: string, name: string, spend: number, installs: number, extra: Partial<MetaAdHistoryRow> = {}): MetaAdHistoryRow => ({
  date, campaign_id: "c1", campaign_name: "Camp", adset_id: "s1", adset_name: "Set", ad_id: name, ad_name: name,
  spend, impressions: spend * 10, reach: 0, frequency: 1, clicks: spend / 10, link_clicks: spend / 20, installs, video_3s: 0, thruplays: 0,
  ...extra,
});

test("periods: in-progress today, completed-day yesterday, trailing 7 vs prior 7, MTD vs same elapsed days last month", () => {
  const p = metaPeriods("2026-10-18", "2026-10-18");
  assert.deepEqual(p.map((x) => [x.id, x.from, x.to, x.cmpFrom, x.cmpTo, x.partial]), [
    ["today", "2026-10-18", "2026-10-18", "2026-10-17", "2026-10-17", true],
    ["day", "2026-10-17", "2026-10-17", "2026-10-16", "2026-10-16", false],
    ["last7", "2026-10-11", "2026-10-17", "2026-10-04", "2026-10-10", false],
    ["mtd", "2026-10-01", "2026-10-17", "2026-09-01", "2026-09-17", false],
  ]);
  // Past end date: no "today" row; MTD on 31 Mar compares with all of February (shorter month is capped).
  const q = metaPeriods("2026-03-31", "2026-10-18");
  assert.equal(q[0].id, "day");
  assert.deepEqual([q[2].cmpFrom, q[2].cmpTo], ["2026-02-01", "2026-02-28"]);
});

test("partial day: totals are not compared, rates are", () => {
  const hist = [ad("2026-10-18", "A", 100, 2), ad("2026-10-17", "A", 1000, 20)];
  const orders: OrdersDailyRow[] = [];
  const [today] = periodBlocks(hist, metaPeriods("2026-10-18", "2026-10-18"), null, orders);
  const spend = today.rows.find((r) => r.key === "spend")!;
  const cpi = today.rows.find((r) => r.key === "cpi")!;
  assert.equal(spend.pct, null);
  assert.equal(cpi.pct, 0); // ₹50 vs ₹50
  assert.equal(today.rows.find((r) => r.key === "af_atc")?.value, null); // no AppsFlyer data passed → not invented
  // MTD vs 1–17 Sep: adwatch starts 12 Sep, so totals are not compared.
  const mtd = periodBlocks(hist, metaPeriods("2026-10-18", "2026-10-18"), null, orders).find((b) => b.period.id === "mtd")!;
  assert.equal(mtd.metaComparable, false);
  assert.equal(mtd.rows.find((r) => r.key === "spend")!.pct, null);
});

test("CPI decomposition names the driver and never claims purchases", () => {
  const prior = totals([ad("2026-10-01", "A", 10000, 200)]);
  // Same CPM and CTR, worse click → install: CPI rises because of post-click.
  const recent = totals([ad("2026-10-08", "A", 10000, 100)]);
  const ins = metaInsights({ recent, prior, afRecent: null, afPrior: null, salesRecent: null, salesPrior: null,
    creatives: analyseCreatives([], null, { from: "2026-10-01", to: "2026-10-08" }), placementAvailable: false });
  const d = ins.find((i) => i.id === "meta-cpi-decomposition")!;
  assert.match(d.title, /click → install/);
  assert.equal(d.causes[0].status, "confirmed");
  assert.ok(ins.some((i) => i.id === "meta-placement-gap" && i.kind === "tracking"));
  assert.ok(!ins.some((i) => /ROAS|attributed purchase/i.test(i.title)));
});

test("creatives: no verdict on small samples; winners, underperformers and fatigue against the account baseline", () => {
  const days = Array.from({ length: 21 }, (_, i) => addDays("2026-09-20", i));
  const hist: MetaAdHistoryRow[] = [];
  for (const [i, d] of days.entries()) {
    hist.push(ad(d, "Winner", 1000, 20)); // CPI 50
    hist.push(ad(d, "Heavy", 3000, 20)); // CPI 150, big spend share
    hist.push(ad(d, "Fading", 1000, i < 14 ? 12 : 6)); // CPI 83 → 167 in the last 7 days
  }
  hist.push(ad("2026-10-09", "Tiny", 300, 3)); // too little data
  const a = analyseCreatives(hist, null, { from: days[0], to: days[days.length - 1] });
  const cls = Object.fromEntries(a.creatives.map((c) => [c.name, c.cls]));
  assert.equal(cls.Winner, "proven_winner");
  assert.equal(cls.Heavy, "high_spend_underperformer");
  assert.equal(cls.Fading, "fatigue");
  assert.equal(cls.Tiny, "too_early");
  assert.equal(a.creatives.find((c) => c.name === "Tiny")!.cohort, "pre_oct"); // not on the October list
});

test("table change signals need enough installs before flagging CPI", () => {
  assert.equal(changeSignal({ spend: 1000, installs: 5 }, undefined), "New this period");
  assert.match(changeSignal({ spend: 2000, installs: 20 }, { spend: 1000, installs: 20 }), /CPI rising/);
  assert.equal(changeSignal({ spend: 2000, installs: 4 }, { spend: 1900, installs: 8 }), "");
});

test("October list: ads map to list creatives, everything else is pre-October, mixed ads are excluded", () => {
  assert.equal(new Set(OCT_CREATIVES.map((c) => c.name)).size, OCT_CREATIVES.length); // no duplicates
  assert.deepEqual(creativeOf("App_UGC_3_051026"), { key: "UGC 3", cohort: "oct", format: "Video", match: "exact" });
  assert.equal(creativeOf("App_Static_Heavy_Bills_151026").format, "Static"); // from the .jpg extension
  assert.equal(creativeOf("App_Video_Breaking_News-1-041026").cohort, "pre_oct"); // re-uploaded older creative
  assert.equal(creativeOf("App_Flexi_Ad_Creative_Test_set32_051026").cohort, "mixed");
  assert.equal(creativeOf("App_Video_Marathi_MutliVideoAd_070926").cohort, "mixed");
});

test("winning rate counts October creatives only; several ads of one creative roll up together", () => {
  const hist: MetaAdHistoryRow[] = [];
  for (let i = 0; i < 10; i++) {
    const d = addDays("2026-10-06", i);
    hist.push(ad(d, "App_Creative_Test_UGC_3_051026", 600, 10)); // UGC 3, ad 1 → CPI 60
    hist.push(ad(d, "App_UGC_3_051026", 600, 10)); // UGC 3, ad 2
    hist.push(ad(d, "App_Creative_Test_UGC_4_061026", 3000, 15)); // UGC 4 → CPI 200
    hist.push(ad(d, "App_Video_Telma_041026", 3000, 30)); // pre-October, never in the rate
  }
  const a = analyseCreatives(hist, null, { from: "2026-10-06", to: "2026-10-15" });
  const ugc3 = a.creatives.find((c) => c.key === "UGC 3")!;
  assert.equal(ugc3.ads, 2);
  assert.equal(ugc3.installs, 200);
  assert.equal(ugc3.cls, "proven_winner");
  const co = octCohort(a);
  assert.equal(co.overall.live, 2);
  assert.equal(co.overall.judged, 2);
  assert.equal(co.overall.winners, 1);
  assert.equal(co.overall.winRate, 0.5);
  assert.equal(co.preOct.live, 1);
  assert.ok(co.notLive.includes("Billboard_1.jpg"));
});
