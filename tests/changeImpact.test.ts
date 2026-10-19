// Perf change impact: changes are detected only where delivery data proves them, log entries attach to the right change,
// before / after windows are equal length and exclude today, and verdicts / confidence follow the written rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessChange, detectChanges, impactWindows, mergeLog, type ImpactInputs } from "../lib/metrics/changeImpact.ts";
import type { ChangeLogRow, MetaAdHistoryRow, OrdersDailyRow } from "../lib/types/schemas.ts";

const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 8, 12 + n)); // n = 0 → 12 Sep 2026 (adwatch coverage start)
  return d.toISOString().slice(0, 10);
};
const row = (date: string, campaign: string, spend: number, installs = spend / 100, ad = `${campaign}-a`, adset = `${campaign}-s`): MetaAdHistoryRow => ({
  date, campaign_id: campaign, campaign_name: `MI_AKIDHA_Meta_APP_${campaign}`, adset_id: adset, adset_name: adset, ad_id: ad, ad_name: ad,
  spend, impressions: spend * 10, reach: 0, frequency: 0, clicks: spend / 10, link_clicks: spend / 20, installs, video_3s: 0, thruplays: 0,
});

// Base campaign A spends 10,000/day throughout; B launches on day 20; A doubles from day 30; C stops after day 25.
const LAST = day(40);
const history: MetaAdHistoryRow[] = [];
for (let n = 0; n <= 40; n++) {
  history.push(row(day(n), "A", n >= 30 ? 20000 : 10000));
  if (n >= 20) history.push(row(day(n), "B", 3000));
  if (n <= 25) history.push(row(day(n), "C", 2000));
}

test("detects launches, pauses and spend steps; never a launch on the first day of coverage", () => {
  const cs = detectChanges(history, day(1), LAST, LAST);
  const kinds = cs.map((c) => `${c.kind}:${c.campaignIds[0]}:${c.date}`);
  assert.ok(kinds.includes(`campaign_launch:B:${day(20)}`));
  assert.ok(kinds.includes(`campaign_pause:C:${day(26)}`));
  assert.ok(kinds.includes(`spend_up:A:${day(30)}`));
  assert.ok(!cs.some((c) => c.date === day(0)));
  assert.equal(cs.find((c) => c.kind === "spend_up")?.inferred, true);
  // One spend step per campaign, not one per day of the new level.
  assert.equal(cs.filter((c) => c.kind === "spend_up" && c.campaignIds[0] === "A").length, 1);
});

const log = (over: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: 1, title: "t", type: null, owner: null, created_by: null, hypothesis: null, scope: null, start_date: day(20), review_date: null, status: null,
  primary_metric: null, target_value: null, target_dir: null, verdict: null, decision: null, closed_at: null, ...over,
});

test("log entries attach to the detected change of the campaign they name; CRM entries stay separate", () => {
  const cs = detectChanges(history, day(1), LAST, LAST);
  const merged = mergeLog(
    cs,
    [
      log({ id: 7, title: "Launch campaign B for new customers", owner: "PM lead", hypothesis: "New-customer audience lowers CAC", primary_metric: "cac", target_dir: "down", target_value: 900, review_date: day(34), scope: '{"campaign":"B"}' }),
      log({ id: 8, title: "Abd cart lead recycling", type: "Lead-routing or dialer change", start_date: day(22) }),
    ],
    day(1),
    LAST,
  );
  const b = merged.find((c) => c.kind === "campaign_launch")!;
  assert.equal(b.source, "Detected + logged");
  assert.equal(b.who, "PM lead");
  assert.match(b.expected ?? "", /cac down to 900/);
  const crm = merged.find((c) => c.logId === 8)!;
  assert.equal(crm.area, "CRM");
  assert.equal(crm.kind, "logged");
});

test("before / after windows are equal length and stop at the last complete day", () => {
  assert.deepEqual(impactWindows(day(30), LAST), { pre: { from: day(23), to: day(29) }, post: { from: day(30), to: day(36) }, days: 7 });
  const short = impactWindows(day(39), LAST);
  assert.equal(short.days, 2);
  assert.deepEqual(short.pre, { from: day(37), to: day(38) });
});

const fresh = (date: string, orders: number): OrdersDailyRow => ({ order_date: date, channel: "APP", order_type: "Fresh", orders, unique_customers: orders, revenue: orders * 500, completed_orders: 0, completed_revenue: 0, avg_patient_age: null });

test("verdicts: more spend with flat New Sales is negative; too few days is 'too early' and says wait", () => {
  const orders = Array.from({ length: 41 }, (_, n) => fresh(day(n), 20));
  const x: ImpactInputs = { history, reach: null, leads: [], orders };
  const cs = detectChanges(history, day(1), LAST, LAST);
  const up = cs.find((c) => c.kind === "spend_up")!;
  const a = assessChange(up, x, { pre: null, post: null }, cs, [], LAST);
  assert.equal(a.verdict, "Negative"); // spend +~70% account-wide, New Sales flat → CAC up
  assert.ok(a.rows.some((r) => r.scope === "Affected campaigns" && r.key === "spend"));
  assert.ok(a.uncertainties.some((u) => /Inferred from spend/.test(u)));
  assert.ok(a.questions.some((q) => /Who made this change/.test(q)));
  const late = assessChange({ ...up, id: "late", date: day(40) }, x, { pre: null, post: null }, cs, [], LAST);
  assert.equal(late.verdict, "Too early");
  assert.equal(late.decision, "Wait");
});
