// Daily Growth War Room: intraday pacing, dependency-aware diagnosis and ranked actions. Pure (no I/O).
//
// Every number is "today so far" against earlier days counted to the same time of day, so a quiet morning is never
// compared with a full day. What the page SHOWS is Now vs Yesterday / Last 7 days / MTD (per-day averages, all to the
// same minute — see sameTime.ts); the ALERTS use the median of the previous days, which one odd day cannot move.
// Outcomes are explained through the chain that produces them:
//
//   Paid app path  : Meta spend → Meta installs → (AppsFlyer) add to cart → checkout → payment → APP Fresh order
//   Sales-team path: cart leads · prescription uploads · inbound calls → calls / callbacks → WEB Fresh order
//                    (WEB orders happen 09:00–21:00 IST only — no WEB alert outside those hours)
//   Region         : which ad sets spend decides where orders come from (Mumbai / Priority Mumbai vs Tier 3)
//   Supply         : call outcomes MEDICINE_UNAVAILABLE / BRANDED_ONLY / DELIVERY_DELAY / PRICE_ISSUE lose orders the
//                    funnel already won
//
// A New Sales shortfall is attributed to the first link in its path that is materially off, so the action goes to the
// team that owns that link. Thresholds are volume-aware: a gap must exceed both 20% and ~2 standard deviations of a
// Poisson count (2·√expected) before it is called a problem.

import { AF_FIRST_FULL_DAY } from "./metaIntel.ts";
import { targetingOf } from "./regionalInsights.ts";
import { avgOver, ratioOver, type SameTimeWindow } from "./sameTime.ts";
import type { ActionInsight } from "./actionInsights.ts";
import type { WarRoomRow } from "../types/schemas";

const median = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const pc1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`;

export const SALES_HOURS = { from: 9 * 60, to: 21 * 60 };

export interface Paced {
  today: number;
  /** Median of previous days counted to the same time of day. */
  usual: number | null;
  /** Median full-day value of previous days. */
  usualFull: number | null;
  pace: number | null;
  /** today ÷ median share-of-day reached by this time on previous days. */
  projected: number | null;
  /** Gap beyond noise: |today − usual| > max(20%·usual, 2·√usual). */
  significant: boolean;
  days: number;
}

export class WarData {
  private by = new Map<string, WarRoomRow[]>();
  constructor(
    readonly rows: readonly WarRoomRow[],
    readonly today: string,
  ) {
    for (const r of rows) {
      const k = `${r.metric}|${r.segment}`;
      this.by.set(k, [...(this.by.get(k) ?? []), r]);
    }
  }
  series(metric: string, segment = "all") {
    return this.by.get(`${metric}|${segment}`) ?? [];
  }
  segments(metric: string) {
    return [...new Set(this.rows.filter((r) => r.metric === metric).map((r) => r.segment))];
  }
  labelOf(metric: string, segment: string) {
    return this.series(metric, segment).find((r) => r.label)?.label ?? segment;
  }
  value(metric: string, segment = "all", day = this.today) {
    return this.series(metric, segment).find((r) => r.day === day)?.so_far ?? 0;
  }
  /** Whole-day value of an earlier day (0 when absent; today has none). */
  fullValue(metric: string, segment: string, day: string) {
    return this.series(metric, segment).find((r) => r.day === day)?.full ?? 0;
  }
  /** Per-day average to the cut-off over a same-time window (only days the metric's source covers). */
  win(metric: string, segment: string, days: readonly string[]) {
    return avgOver(days, (d) => this.value(metric, segment, d), coverageFrom(metric));
  }
  /** Σnum ÷ Σden to the cut-off over a same-time window. */
  winRatio(num: readonly [string, string], den: readonly [string, string], days: readonly string[]) {
    const since = [coverageFrom(num[0]), coverageFrom(den[0])].sort()[1];
    return ratioOver(days, (d) => this.value(num[0], num[1], d), (d) => this.value(den[0], den[1], d), since);
  }
  paced(metric: string, segment = "all", historyDays = 14): Paced {
    const rows = this.series(metric, segment);
    const today = rows.find((r) => r.day === this.today)?.so_far ?? 0;
    const start = shift(this.today, -historyDays);
    const prior = priorDays(this.today, start).map((d) => rows.find((r) => r.day === d) ?? { so_far: 0, full: 0 });
    const has = prior.filter((p) => (p.full ?? 0) > 0 || p.so_far > 0);
    const usual = has.length >= 3 ? median(prior.map((p) => p.so_far)) : null;
    const usualFull = has.length >= 3 ? median(prior.map((p) => p.full ?? 0)) : null;
    const shares = prior.filter((p) => (p.full ?? 0) > 0).map((p) => p.so_far / (p.full as number));
    const share = median(shares);
    const pace = usual ? today / usual - 1 : null;
    const significant = usual !== null && Math.abs(today - usual) > Math.max(0.2 * usual, 2 * Math.sqrt(Math.max(usual, 1)));
    return { today, usual, usualFull, pace, projected: share && share > 0.05 ? today / share : null, significant, days: has.length };
  }
  /** Ratio of two metrics today vs the median of the same ratio on previous days (both to the cut-off). */
  ratio(num: [string, string], den: [string, string], historyDays = 7) {
    const today = div(this.value(...num), this.value(...den));
    const days = priorDays(this.today, shift(this.today, -historyDays));
    const vals = days
      .map((d) => ({ n: this.value(num[0], num[1], d), d: this.value(den[0], den[1], d) }))
      .filter((x) => x.d > 0)
      .map((x) => x.n / x.d);
    const usual = vals.length >= 3 ? median(vals) : null;
    return { today, usual, change: today !== null && usual ? today / usual - 1 : null, todayNum: this.value(...num), todayDen: this.value(...den) };
  }
}

/** AppsFlyer real-time events start 6 Oct 2026, 17:00 IST: earlier hours have no rows, which is not zero activity. */
const coverageFrom = (metric: string) => (metric.startsWith("af_") ? AF_FIRST_FULL_DAY : "");

function shift(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function priorDays(today: string, from: string) {
  const out: string[] = [];
  for (let d = from; d < today; d = shift(d, 1)) out.push(d);
  return out;
}

// ---------- Pulse ----------

export interface PulseTile {
  key: string;
  label: string;
  sub: string;
  format: "count" | "inr" | "pct";
  today: number | null;
  /** The same-time windows after "now" (Yesterday / Last 7 days / MTD), each counted to the same time of day. */
  cmps: { id: string; short: string; value: number | null }[];
  usual: number | null;
  pace: number | null;
  projected: number | null;
  /** true = higher is better. */
  up: boolean;
  alert: boolean;
}

export function pulse(w: WarData, windows: readonly SameTimeWindow[]): PulseTile[] {
  const earlier = windows.filter((x) => x.id !== "now");
  const cmpsOf = (v: (days: readonly string[]) => number | null) => earlier.map((x) => ({ id: x.id, short: x.short, value: v(x.days) }));
  const t = (key: string, label: string, sub: string, metric: string, segment = "all", historyDays = 14, up = true, format: PulseTile["format"] = "count"): PulseTile => {
    const p = w.paced(metric, segment, historyDays);
    return {
      key, label, sub, format, today: p.today, cmps: cmpsOf((days) => w.win(metric, segment, days)), usual: p.usual, pace: p.pace, projected: p.projected, up,
      alert: p.significant && p.pace !== null && (up ? p.pace < 0 : p.pace > 0),
    };
  };
  const cps = w.ratio(["spend", "all"], ["new_sales", "all"], 14);
  const fail = w.ratio(["af_Payment_failed", "all"], ["af_af_initiated_checkout", "all"]);
  return [
    t("new_sales", "New Sales", "Fresh orders, APP + WEB", "new_sales"),
    t("app", "APP", "self-serve", "new_sales", "APP"),
    t("web", "WEB", "sales-assisted", "new_sales", "WEB"),
    t("mmr", "Mumbai (MMR)", "Priority + rest of MMR", "new_sales", "mmr"),
    t("priority", "Priority Mumbai", "pincode list", "new_sales", "priority_mumbai"),
    t("spend", "Meta spend", "to last loaded hour", "spend", "all", 14, true, "inr"),
    {
      key: "cps", label: "Spend per New Sale", sub: "today so far", format: "inr", today: cps.today, usual: cps.usual, pace: cps.change, projected: null, up: false,
      cmps: cmpsOf((days) => w.winRatio(["spend", "all"], ["new_sales", "all"], days)),
      alert: cps.change !== null && cps.change >= 0.25 && cps.todayDen >= 5,
    },
    t("leads", "Fresh cart leads", "CRM", "fresh_leads", "all", 7),
    t("rx", "Prescription uploads", "awaiting order", "rx_uploads"),
    {
      key: "payfail", label: "Payment failures", sub: "failed ÷ checkout (AppsFlyer)", format: "pct", today: fail.today, usual: fail.usual, pace: fail.change, projected: null, up: false,
      cmps: cmpsOf((days) => w.winRatio(["af_Payment_failed", "all"], ["af_af_initiated_checkout", "all"], days)),
      alert: fail.change !== null && fail.change >= 0.4 && w.value("af_Payment_failed") >= 5,
    },
  ];
}

// ---------- Curves ----------

export function cumulativeCurve(w: WarData, metric: "new_sales_h" | "spend_h", cutHour: number) {
  const days = priorDays(w.today, shift(w.today, -14));
  const at = (d: string, h: number) => w.series(metric, String(h)).find((r) => r.day === d)?.full ?? (d === w.today ? (w.series(metric, String(h)).find((r) => r.day === d)?.so_far ?? 0) : 0);
  const cum = (d: string, h: number) => {
    let s = 0;
    for (let i = 0; i <= h; i++) s += at(d, i);
    return s;
  };
  return Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    today: h <= cutHour ? cum(w.today, h) : null,
    usual: median(days.map((d) => cum(d, h))),
    yesterday: cum(shift(w.today, -1), h),
  }));
}

// ---------- Funnel links ----------

export interface LinkRow {
  key: string;
  path: "Paid app" | "Sales team";
  link: string;
  today: number | null;
  usual: number | null;
  change: number | null;
  detail: string;
  /** true when this link is materially worse than usual. */
  broken: boolean;
  format: "pct" | "inr";
  /** For costs, higher = worse. */
  higherIsWorse: boolean;
  /** The ratio's (metric, segment) pairs, for same-time windows. */
  num: readonly [string, string];
  den: readonly [string, string];
}

export function funnelLinks(w: WarData): LinkRow[] {
  const L = (key: string, path: LinkRow["path"], link: string, num: [string, string], den: [string, string], historyDays: number, format: LinkRow["format"], higherIsWorse: boolean, minDen: number): LinkRow => {
    const r = w.ratio(num, den, historyDays);
    const worse = r.change !== null && (higherIsWorse ? r.change >= 0.25 : r.change <= -0.2) && r.todayDen >= minDen;
    return { key, path, link, today: r.today, usual: r.usual, change: r.change, detail: `${n0(r.todayNum)} / ${n0(r.todayDen)}`, broken: worse, format, higherIsWorse, num, den };
  };
  return [
    L("cpi", "Paid app", "Spend → install (CPI, Meta)", ["spend", "all"], ["installs", "all"], 14, "inr", true, 20),
    L("inst_atc", "Paid app", "Install → add to cart (AppsFlyer, paid)", ["af_af_add_to_cart", "all"], ["af_install", "all"], 7, "pct", false, 50),
    L("atc_co", "Paid app", "Add to cart → checkout", ["af_af_initiated_checkout", "all"], ["af_af_add_to_cart", "all"], 7, "pct", false, 20),
    L("co_pay", "Paid app", "Checkout → payment success", ["af_af_purchase", "all"], ["af_af_initiated_checkout", "all"], 7, "pct", false, 15),
    L("atc_app", "Paid app", "Add to cart → APP Fresh order", ["new_sales", "APP"], ["af_af_add_to_cart", "all"], 7, "pct", false, 20),
    L("lead_web", "Sales team", "Fresh cart lead → WEB Fresh order", ["new_sales", "WEB"], ["fresh_leads", "all"], 7, "pct", false, 15),
    L("rx_conv", "Sales team", "Prescription upload → order", ["rx_converted", "all"], ["rx_uploads", "all"], 14, "pct", false, 8),
  ];
}

// ---------- Campaign / ad set / ad scorecards ----------

export interface EntityRow {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  spend: number;
  installs: number;
  cpi: number | null;
  usual_cpi: number | null;
  cpi_change: number | null;
  /** Today's spend vs the usual spend by this time (campaigns) or vs a 7-day daily average (ad sets / ads). */
  spend_change: number | null;
  mumbai: boolean;
  verdict: string;
}

export function campaignBoard(w: WarData): EntityRow[] {
  return w
    .segments("spend")
    .filter((s) => s.startsWith("campaign:"))
    .map((seg) => {
      const sp = w.paced("spend", seg);
      const ins = w.paced("installs", seg);
      const cpi = div(sp.today, ins.today);
      const usualCpi = div(sp.usual, ins.usual);
      const name = w.labelOf("spend", seg);
      return verdict({ level: "campaign", id: seg.slice(9), name, spend: sp.today, installs: ins.today, cpi, usual_cpi: usualCpi, cpi_change: cpi !== null && usualCpi ? cpi / usualCpi - 1 : null, spend_change: sp.pace, mumbai: targetingOf(null, name) === "mumbai", verdict: "" });
    })
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

export function adBoard(w: WarData, level: "adset" | "ad", accountCpi: number | null): EntityRow[] {
  const days = priorDays(w.today, shift(w.today, -7));
  return w
    .segments("ad_spend")
    .filter((s) => s.startsWith(`${level}:`))
    .map((seg) => {
      const spend = w.value("ad_spend", seg);
      const installs = w.value("ad_installs", seg);
      // CPI baseline from whole days; spend change vs earlier days' spend to the same hour.
      const ps = days.reduce((a, d) => a + w.fullValue("ad_spend", seg, d), 0);
      const pi = days.reduce((a, d) => a + w.fullValue("ad_installs", seg, d), 0);
      const psSoFar = days.reduce((a, d) => a + w.value("ad_spend", seg, d), 0);
      const active = days.filter((d) => w.fullValue("ad_spend", seg, d) > 0).length;
      const cpi = div(spend, installs);
      const usualCpi = pi >= 10 ? ps / pi : accountCpi;
      const name = w.labelOf("ad_spend", seg);
      const adsetName = name.split(" › ")[1] ?? name;
      return verdict({
        level, id: seg.slice(level.length + 1), name, spend, installs, cpi, usual_cpi: usualCpi,
        cpi_change: cpi !== null && usualCpi ? cpi / usualCpi - 1 : installs === 0 && spend > 0 && usualCpi ? Infinity : null,
        spend_change: active && psSoFar ? spend / (psSoFar / active) - 1 : null, mumbai: targetingOf(adsetName, null) === "mumbai", verdict: "",
      }, usualCpi);
    })
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

function verdict(r: EntityRow, refCpi: number | null = r.usual_cpi): EntityRow {
  const ref = refCpi ?? 0;
  let v = "";
  if (r.installs === 0 && ref && r.spend >= 2 * ref) v = "Spending with no installs — check / pause";
  else if (r.cpi_change !== null && r.cpi_change >= 0.5 && ref && r.spend >= 3 * ref) v = "CPI far above its usual — cut budget";
  else if (r.cpi_change !== null && r.cpi_change >= 0.3 && ref && r.spend >= 3 * ref) v = "CPI worse than usual — watch";
  else if (r.cpi_change !== null && r.cpi_change <= -0.25 && r.installs >= 15) v = "CPI better than usual — candidate to scale";
  return { ...r, verdict: v };
}

// ---------- CRM queue ----------

export interface QueueRow {
  type: string;
  open: number;
  never_dialled: number;
  callback_overdue: number;
}

export function crmQueue(w: WarData): QueueRow[] {
  return w
    .segments("task_open")
    .map((t) => ({ type: t, open: w.value("task_open", t), never_dialled: w.value("task_never_dialled", t), callback_overdue: w.value("task_callback_overdue", t) }))
    .sort((a, b) => b.never_dialled + b.callback_overdue - (a.never_dialled + a.callback_overdue));
}

const SUPPLY_OUTCOMES = ["MEDICINE_UNAVAILABLE", "BRANDED_ONLY", "DELIVERY_DELAY", "PRICE_ISSUE", "BANNED_MEDICINE"] as const;

/** Not-connected outcomes: excluded from shares, because older days' unanswered tasks were redialled later and their
 * last outcome overwritten — comparing raw mixes would make today look worse than it is. */
const NOT_CONNECTED: ReadonlySet<string> = new Set(["NO_ANSWER", "SWITCHED_OFF", "BUSY", "DND", "AUTO_WRAP", "NONE"]);

/** Share of connected calls per outcome over a same-time window (Σ outcome ÷ Σ connected calls, to the cut-off). */
export function outcomeShares(w: WarData, days: readonly string[]): Map<string, number | null> {
  const all = w.segments("call_outcome");
  const connected = all.filter((o) => !NOT_CONNECTED.has(o));
  const total = (d: string) => connected.reduce((s, o) => s + w.value("call_outcome", o, d), 0);
  return new Map(all.map((o) => [o, NOT_CONNECTED.has(o) ? null : ratioOver(days, (d) => w.value("call_outcome", o, d), total)]));
}

export function outcomeMix(w: WarData) {
  const all = w.segments("call_outcome");
  const connected = all.filter((o) => !NOT_CONNECTED.has(o));
  const days = priorDays(w.today, shift(w.today, -7));
  const total = (d: string) => connected.reduce((s, o) => s + w.value("call_outcome", o, d), 0);
  const tToday = total(w.today);
  return all
    .map((o) => {
      const today = w.value("call_outcome", o);
      const isConnected = !NOT_CONNECTED.has(o);
      const shares = days.map((d) => div(w.value("call_outcome", o, d), total(d))).filter((x): x is number => x !== null);
      const usual = isConnected ? median(shares) : null;
      const share = isConnected ? div(today, tToday) : null;
      return { outcome: o, today, share, usual_share: usual, change: share !== null && usual !== null ? share - usual : null, supply: (SUPPLY_OUTCOMES as readonly string[]).includes(o) };
    })
    .filter((r) => r.today > 0 || (r.usual_share ?? 0) > 0.01)
    .sort((a, b) => b.today - a.today);
}

// ---------- Actions ----------

export interface WarContext {
  w: WarData;
  nowMinute: number;
  metaHour: number;
  staleSources: { label: string; latest: string | null }[];
  accountCpi: number | null;
}

type Owner = "Growth · Meta" | "Sales team" | "Product · Payments" | "Ops · Supply" | "Data";
const owned = (owner: Owner, affects: string) => `${owner} · ${affects}`;

export function warActions(c: WarContext): ActionInsight[] {
  const { w } = c;
  const out: ActionInsight[] = [];
  const hhmm = `${String(Math.floor(c.nowMinute / 60)).padStart(2, "0")}:${String(c.nowMinute % 60).padStart(2, "0")}`;
  const inSalesHours = c.nowMinute >= SALES_HOURS.from && c.nowMinute <= SALES_HOURS.to;
  const ns = w.paced("new_sales");
  const app = w.paced("new_sales", "APP");
  const web = w.paced("new_sales", "WEB");
  const spend = w.paced("spend");
  const links = funnelLinks(w);
  const paidBroken = links.filter((l) => l.path === "Paid app" && l.broken);
  const salesBroken = links.filter((l) => l.path === "Sales team" && l.broken);
  const queue = crmQueue(w);
  const q = (type: string) => queue.find((x) => x.type === type);
  const campaigns = campaignBoard(w);
  const adsets = adBoard(w, "adset", c.accountCpi);
  const ordersPerRupee = div(ns.usualFull, w.paced("spend").usualFull);

  // 0. Data first: a stalled feed looks like a sales drop.
  for (const s of c.staleSources) {
    out.push({
      id: `stale-${s.label}`, kind: "tracking", priority: 1, affects: owned("Data", s.label),
      title: `${s.label} data has not updated since ${s.latest ?? "—"} — figures below may understate today`,
      evidence: [`Latest ${s.label} record: ${s.latest ?? "none"}; time now ${hhmm} IST.`],
      causes: [{ text: "Sync job delayed or failed.", status: "hypothesis", confidence: "medium" }],
      levers: ["Data pipeline"], action: "Check the sync job before acting on any pacing alert that depends on this source.",
      impact: "Prevents budget or team changes based on missing data.", followUp: "Source latest timestamp on the next refresh.", weight: 1e12,
    });
  }
  if (c.metaHour >= 0 && Math.floor(c.nowMinute / 60) - c.metaHour >= 3) {
    out.push({
      id: "stale-meta-hourly", kind: "tracking", priority: 2, affects: owned("Data", "Meta hourly spend"),
      title: `Meta hourly spend is ${Math.floor(c.nowMinute / 60) - c.metaHour} hours behind (last hour loaded ${c.metaHour}:00)`,
      evidence: ["adwatch collects Meta hourly; spend pacing below compares only up to the last loaded hour."],
      causes: [{ text: "adwatch collector delay.", status: "hypothesis", confidence: "medium" }], levers: ["Data pipeline"],
      action: "Use Ads Manager for live spend until adwatch catches up.", impact: "Spend pacing is less current than order pacing.", followUp: "Meta last loaded hour.", weight: 1e11,
    });
  }

  // 1. New Sales pace, attributed to the path and link that broke.
  if (ns.usual !== null && ns.significant && (ns.pace ?? 0) < 0) {
    const gap = (ns.usual ?? 0) - ns.today;
    const appGap = Math.max(0, (app.usual ?? 0) - app.today);
    const webGap = Math.max(0, (web.usual ?? 0) - web.today);
    const appShare = appGap + webGap ? appGap / (appGap + webGap) : 0.5;
    const lead = appShare >= 0.6 ? "APP" : appShare <= 0.4 ? "WEB" : "both";
    const chain = lead === "WEB" ? salesBroken : lead === "APP" ? paidBroken : [...paidBroken, ...salesBroken];
    const spendLow = spend.significant && (spend.pace ?? 0) < 0;
    out.push({
      id: "ns-behind", kind: "performance", priority: 1,
      affects: owned(lead === "WEB" ? "Sales team" : "Growth · Meta", "New Sales today"),
      title: `New Sales ${pct(ns.pace!)} vs a normal day by ${hhmm}: ${n0(ns.today)} vs ${n0(ns.usual!)} usual — shortfall mostly ${lead === "both" ? "on APP and WEB" : `on ${lead}`}`,
      evidence: [
        `APP ${n0(app.today)} vs ${n0(app.usual ?? 0)} usual (${app.pace !== null ? pct(app.pace) : "—"}); WEB ${n0(web.today)} vs ${n0(web.usual ?? 0)} (${web.pace !== null ? pct(web.pace) : "—"}).`,
        ns.projected !== null && ns.usualFull !== null ? `On today's pace the day ends near ${n0(ns.projected)} vs ${n0(ns.usualFull)} on a normal day.` : "",
        spendLow ? `Meta spend is also behind: ${inr(spend.today)} vs ${inr(spend.usual ?? 0)} usual by ${c.metaHour}:00 (${pct(spend.pace!)}).` : `Meta spend is on pace (${spend.pace !== null ? pct(spend.pace) : "—"}).`,
        ...chain.map((l) => `Broken link — ${l.link}: ${l.format === "inr" ? inr(l.today ?? 0) : pc1(l.today ?? 0)} today vs ${l.format === "inr" ? inr(l.usual ?? 0) : pc1(l.usual ?? 0)} usual (${pct(l.change!)}).`),
      ].filter(Boolean),
      causes: [
        ...(spendLow && lead !== "WEB" ? [{ text: "Less paid traffic: spend is behind pace, so fewer installs reach the app.", status: "confirmed" as const, confidence: "high" as const }] : []),
        ...chain.map((l) => ({ text: `${l.link} is ${l.higherIsWorse ? "more expensive" : "converting worse"} than usual.`, status: "confirmed" as const, confidence: "medium" as const })),
        ...(chain.length === 0 && !spendLow ? [{ text: "No upstream link is off — demand is simply lower so far (or orders are arriving later than usual).", status: "hypothesis" as const, confidence: "low" as const }] : []),
      ],
      levers: lead === "WEB" ? ["Call queue: leads, prescriptions, inbound", "Sales-team capacity"] : ["Meta delivery and budget", "App funnel step that broke"],
      action:
        lead === "WEB"
          ? "Sales team: clear never-dialled cart and inbound tasks first, then today's prescription uploads (see the queue panel)."
          : spendLow
            ? "Growth: check Ads Manager delivery (budget caps, disapprovals, billing) and restore spend on the campaigns with the best CPI today."
            : paidBroken[0]
              ? `Product: investigate "${paidBroken[0].link}" today — the paid funnel step that broke.`
              : "Growth: hold budgets; re-check at the next refresh before changing anything.",
      impact: `${n0(gap)} New Sales behind a normal day so far${ns.projected !== null && ns.usualFull !== null ? `; about ${n0(Math.max(0, ns.usualFull - ns.projected))} short by midnight if the pace holds` : ""}.`,
      followUp: "New Sales vs usual on the curve, next refresh.", weight: 1e10 + gap,
    });
  } else if (ns.usual !== null && ns.significant && (ns.pace ?? 0) > 0) {
    out.push({
      id: "ns-ahead", kind: "performance", priority: 3, affects: owned("Growth · Meta", "New Sales today"),
      title: `New Sales ahead of a normal day: ${n0(ns.today)} vs ${n0(ns.usual)} by ${hhmm} (${pct(ns.pace!)})`,
      evidence: [`APP ${app.pace !== null ? pct(app.pace) : "—"}, WEB ${web.pace !== null ? pct(web.pace) : "—"} vs usual.`],
      causes: [{ text: "Demand or conversion above normal today.", status: "confirmed", confidence: "medium" }], levers: ["Budget"],
      action: "If spend per New Sale is at or below usual, it is safe to keep the best-CPI campaigns uncapped for the rest of the day.",
      impact: ns.projected !== null ? `Day on course for about ${n0(ns.projected)} New Sales.` : "—", followUp: "Spend per New Sale today.", weight: 1e6,
    });
  }

  // 2. Spend pacing and its two failure modes.
  if (spend.usual !== null && spend.significant && (spend.pace ?? 0) < 0 && c.metaHour >= 9) {
    const shortfall = (spend.usual ?? 0) - spend.today;
    out.push({
      id: "spend-behind", kind: "performance", priority: (spend.pace ?? 0) <= -0.3 ? 1 : 2, affects: owned("Growth · Meta", "Meta delivery"),
      title: `Meta spend ${pct(spend.pace!)} vs usual by ${c.metaHour}:00 (${inr(spend.today)} vs ${inr(spend.usual)}) — New Sales at risk later today`,
      evidence: [
        `Installs ${n0(w.value("installs"))} vs ${n0(w.paced("installs").usual ?? 0)} usual by the same hour.`,
        ...campaigns.filter((x) => (x.spend_change ?? 0) <= -0.4).slice(0, 3).map((x) => `${x.name}: ${inr(x.spend)} (${pct(x.spend_change!)} vs its usual by now).`),
      ],
      causes: [{ text: "Budget cap reached early, ad disapprovals, billing hold or a paused campaign.", status: "hypothesis", confidence: "medium" }],
      levers: ["Budgets", "Ad review status", "Billing"],
      action: "Open Ads Manager: check the campaigns listed for delivery errors and caps; raise budget on the campaign with the best CPI today if delivery is simply capped.",
      impact: ordersPerRupee ? `At the usual ${n0(1 / ordersPerRupee)} ₹ per New Sale, the spend shortfall is about ${n0(shortfall * ordersPerRupee)} New Sales.` : "—",
      followUp: "Spend vs usual at the next hour.", weight: 5e9 + shortfall,
    });
  }
  const appCps = w.ratio(["spend", "all"], ["new_sales", "APP"], 14);
  if (spend.usual !== null && (spend.pace ?? 0) >= 0.15 && app.usual !== null && (app.pace ?? 0) <= 0.05 && appCps.change !== null && appCps.change >= 0.2 && app.today >= 3) {
    out.push({
      id: "spend-ahead-cac", kind: "performance", priority: 1, affects: owned("Growth · Meta", "CAC today"),
      title: `Spend ${pct(spend.pace!)} vs usual but APP New Sales ${pct(app.pace ?? 0)} — spend per APP sale ${pct(appCps.change)} (${inr(appCps.today ?? 0)} vs ${inr(appCps.usual ?? 0)})`,
      evidence: [
        `Spend ${inr(spend.today)} vs ${inr(spend.usual)} usual by ${c.metaHour}:00; APP Fresh orders ${n0(app.today)} vs ${n0(app.usual)}.`,
        ...paidBroken.map((l) => `Where it leaks — ${l.link}: ${pct(l.change!)} vs usual.`),
        ...campaigns.filter((x) => (x.spend_change ?? 0) >= 0.3).slice(0, 3).map((x) => `${x.name}: spend ${pct(x.spend_change!)} vs usual, CPI ${x.cpi !== null ? inr(x.cpi) : "—"} (usual ${x.usual_cpi !== null ? inr(x.usual_cpi) : "—"}).`),
      ],
      causes: [{ text: paidBroken.length ? "Extra spend is not converting: a paid-funnel step is weaker than usual." : "Extra budget is buying installs that have not ordered yet (conversion lag) or lower-intent traffic.", status: paidBroken.length ? "confirmed" : "hypothesis", confidence: "medium" }],
      levers: ["Campaign budgets"],
      action: "Pull back the campaigns that scaled today without better CPI (listed) to their usual pace; keep the best-CPI campaign running.",
      impact: `Today's spend per APP New Sale is ${inr(appCps.today ?? 0)} vs ${inr(appCps.usual ?? 0)} usual — at this rate CAC rises for the day.`,
      followUp: "Spend per APP New Sale at the next refresh.", weight: 6e9,
    });
  }

  // 3. Paid funnel links (each broken link on its own, owned by the team that can fix it).
  for (const l of paidBroken) {
    if (l.key === "cpi") continue; // covered by the campaign board
    const owner: Owner = l.key === "co_pay" ? "Product · Payments" : l.key === "inst_atc" ? "Growth · Meta" : "Product · Payments";
    out.push({
      id: `link-${l.key}`, kind: "performance", priority: l.key === "co_pay" ? 1 : 2, affects: owned(owner, l.link),
      title: `${l.link}: ${pc1(l.today ?? 0)} today vs ${pc1(l.usual ?? 0)} usual (${pct(l.change!)})`,
      evidence: [`${l.detail} by ${hhmm} (AppsFlyer distinct devices / orders, paid users).`],
      causes: [
        l.key === "inst_atc"
          ? { text: "Installs from a lower-intent source today (check which campaign scaled), or search / stock problems in the app.", status: "hypothesis", confidence: "medium" }
          : l.key === "co_pay"
            ? { text: "Payment gateway or UPI issue — failures rise and successes fall at the same time.", status: "hypothesis", confidence: "medium" }
            : { text: "Cart-page or checkout friction (fees, prescription step, stock).", status: "hypothesis", confidence: "low" },
      ],
      levers: l.key === "co_pay" ? ["Payment gateway / method"] : ["App flow"],
      action:
        l.key === "co_pay"
          ? "Urgent: test a UPI and a card payment now; check the gateway dashboard for errors; if the gateway is degraded, push COD or an alternative method."
          : l.key === "inst_atc"
            ? "Check which campaign took today's extra installs (campaign board) and whether search / product pages load; pause the source if installs are not reaching the cart."
            : "Walk through cart → checkout on the app for a top product; check for fee, stock or prescription-step changes today.",
      impact: "Every paid install that stops at this step today is spend without a New Sale.", followUp: `${l.link} at the next refresh.`, weight: 4e9,
    });
  }
  const fail = w.ratio(["af_Payment_failed", "all"], ["af_af_initiated_checkout", "all"]);
  if (fail.change !== null && fail.change >= 0.4 && w.value("af_Payment_failed") >= 5) {
    out.push({
      id: "payfail", kind: "performance", priority: 1, affects: owned("Product · Payments", "Payment failures"),
      title: `Payment failures high: ${n0(w.value("af_Payment_failed"))} failing devices = ${pc1(fail.today ?? 0)} of checkouts vs ${pc1(fail.usual ?? 0)} usual — check urgently`,
      evidence: [`AppsFlyer Payment_failed devices ÷ checkout devices by ${hhmm}; paid users only (WEB and organic not covered).`],
      causes: [{ text: "Gateway / UPI degradation or a broken payment method.", status: "hypothesis", confidence: "medium" }],
      levers: ["Payment gateway", "COD availability"],
      action: "Test payments now; ask the gateway for an incident status; temporarily surface COD; have the sales team call today's failed-payment users.",
      impact: "Failed payments are customers who already decided to buy.", followUp: "Failure rate at the next refresh.", weight: 7e9,
    });
  }

  // 4. Campaign, ad set and ad movers.
  const worstC = campaigns.filter((x) => x.verdict.startsWith("CPI far") || x.verdict.startsWith("Spending with no"));
  const bestC = campaigns.filter((x) => x.verdict.includes("scale"));
  const worstA = adsets.filter((x) => x.verdict && !x.verdict.includes("scale")).slice(0, 4);
  const bestA = adsets.filter((x) => x.verdict.includes("scale")).slice(0, 3);
  if (worstC.length || worstA.length) {
    const waste = [...worstC, ...worstA].reduce((s, x) => s + Math.max(0, x.spend - x.installs * (x.usual_cpi ?? 0)), 0);
    out.push({
      id: "entities-worse", kind: "performance", priority: waste >= 3000 ? 1 : 2, affects: owned("Growth · Meta", "Campaigns / ad sets today"),
      title: `${worstC.length + worstA.length} campaign / ad set${worstC.length + worstA.length > 1 ? "s" : ""} buying installs far above their usual CPI today`,
      evidence: [...worstC, ...worstA].slice(0, 5).map((x) => `${x.level === "campaign" ? "Campaign" : "Ad set"} ${x.name}: ${inr(x.spend)} → ${n0(x.installs)} installs, CPI ${x.cpi !== null ? inr(x.cpi) : "none"} vs usual ${x.usual_cpi !== null ? inr(x.usual_cpi) : "—"} — ${x.verdict}.`),
      causes: [{ text: "Audience saturation or a creative that stopped working; Meta keeps spending until capped.", status: "hypothesis", confidence: "medium" }],
      levers: ["Ad set budgets", "Pausing"],
      action: `Cut budget on the listed items now${bestA.length || bestC.length ? ` and move it to ${[...bestC, ...bestA].slice(0, 2).map((x) => x.name.split(" › ").pop()).join(" and ")}` : ""}; re-check CPI in two hours.`,
      impact: `About ${inr(waste)} of today's spend is above what the usual CPI would have cost.`, followUp: "CPI of the listed items at the next refresh.", weight: 3e9 + waste,
    });
  }
  if (bestC.length || bestA.length) {
    out.push({
      id: "entities-better", kind: "performance", priority: 3, affects: owned("Growth · Meta", "Campaigns / ad sets today"),
      title: `${bestC.length + bestA.length} campaign / ad set${bestC.length + bestA.length > 1 ? "s are" : " is"} beating its usual CPI by 25%+ today`,
      evidence: [...bestC, ...bestA].slice(0, 4).map((x) => `${x.name}: CPI ${x.cpi !== null ? inr(x.cpi) : "—"} vs usual ${x.usual_cpi !== null ? inr(x.usual_cpi) : "—"} on ${n0(x.installs)} installs.`),
      causes: [{ text: "Better auction or creative performance today; confirm it holds before large increases.", status: "hypothesis", confidence: "low" }],
      levers: ["Budget"], action: "Raise budget 15–20% on the best one (not more — large jumps reset learning) and re-check in two hours.",
      impact: "Shifts the day's spend towards cheaper installs.", followUp: "CPI of the scaled item, next refresh.", weight: 1e8,
    });
  }

  // 5. Mumbai / Priority Mumbai midday check.
  const mmr = w.paced("new_sales", "mmr");
  const pm = w.paced("new_sales", "priority_mumbai");
  const t3 = w.paced("new_sales", "tier_3");
  if (c.nowMinute >= 11 * 60 && mmr.usual !== null && mmr.usual >= 3 && (mmr.pace ?? 0) <= -0.25 && (mmr.pace ?? 0) < (ns.pace ?? 0) - 0.15) {
    const mumbaiSets = adsets.filter((x) => x.mumbai);
    out.push({
      id: "mmr-behind", kind: "performance", priority: 1, affects: owned("Growth · Meta", "Mumbai New Sales"),
      title: `Mumbai is lagging: ${n0(mmr.today)} MMR New Sales vs ${n0(mmr.usual)} usual by ${hhmm} (${pct(mmr.pace!)}), while all New Sales are ${ns.pace !== null ? pct(ns.pace) : "—"}`,
      evidence: [
        `Priority Mumbai pincodes ${n0(pm.today)} vs ${n0(pm.usual ?? 0)} usual; Tier 3 ${n0(t3.today)} vs ${n0(t3.usual ?? 0)} (${t3.pace !== null ? pct(t3.pace) : "—"}).`,
        mumbaiSets.length ? `Mumbai-named ad sets today: ${mumbaiSets.slice(0, 3).map((x) => `${x.name.split(" › ").pop()} ${inr(x.spend)} (CPI ${x.cpi !== null ? inr(x.cpi) : "—"})`).join("; ")}.` : "No Mumbai-named ad set has spent today.",
      ],
      causes: [{ text: "Today's budget is delivering outside Mumbai (broad / Maharashtra-wide ad sets), or Mumbai ad sets are capped.", status: "hypothesis", confidence: "medium" }],
      levers: ["Budget split towards Mumbai ad sets", "Mumbai sales-team calls"],
      action: mumbaiSets.length
        ? "Shift 15–20% of today's remaining budget from broad / Maharashtra ad sets to the Mumbai ad sets listed; ask the sales team to prioritise Mumbai cart leads and prescriptions this afternoon."
        : "Turn on (or raise) a Mumbai-targeted ad set for the afternoon peak; prioritise Mumbai cart leads in the call queue.",
      impact: `${n0(Math.max(0, mmr.usual - mmr.today))} Mumbai New Sales behind a normal day so far.`, followUp: "MMR New Sales vs usual by 16:00.", weight: 2e9,
    });
  }

  // 6. Sales-team queue: the highest-intent people waiting right now.
  const inbound = q("inbound");
  const cart = q("cart");
  const urgent = q("urgent");
  const neverHot = (inbound?.never_dialled ?? 0) + (cart?.never_dialled ?? 0) + (urgent?.never_dialled ?? 0);
  const overdue = (cart?.callback_overdue ?? 0) + (inbound?.callback_overdue ?? 0) + (urgent?.callback_overdue ?? 0);
  if (inSalesHours && (neverHot >= 5 || overdue >= 5)) {
    out.push({
      id: "queue", kind: "performance", priority: neverHot + overdue >= 15 ? 1 : 2, affects: owned("Sales team", "Call queue"),
      title: `${n0(neverHot)} high-intent tasks never dialled and ${n0(overdue)} callbacks overdue right now`,
      evidence: [
        `Inbound: ${n0(inbound?.never_dialled ?? 0)} never dialled, ${n0(inbound?.callback_overdue ?? 0)} callbacks overdue.`,
        `Cart: ${n0(cart?.never_dialled ?? 0)} never dialled, ${n0(cart?.callback_overdue ?? 0)} overdue. Urgent: ${n0(urgent?.never_dialled ?? 0)} never dialled.`,
        `Fresh cart leads today ${n0(w.value("fresh_leads"))} vs ${n0(w.paced("fresh_leads", "all", 7).usual ?? 0)} usual by now.`,
      ],
      causes: [{ text: "Queue larger than team capacity at this hour, or tasks not assigned.", status: "hypothesis", confidence: "medium" }],
      levers: ["Call order", "Agent allocation"],
      action: "Call in this order: inbound → urgent → overdue cart callbacks → new cart leads. Move one agent from winback / retention queues until the hot queue is clear.",
      impact: "These people asked or tried to buy today; every hour of delay lowers conversion.", followUp: "Never-dialled hot tasks at the next refresh (target 0).", weight: 2.5e9,
    });
  }

  // 7. Prescriptions waiting for an order.
  const rxToday = w.value("rx_uploads");
  const rxConv = w.value("rx_converted");
  const rxRate = w.ratio(["rx_converted", "all"], ["rx_uploads", "all"], 14);
  const rxOpen = rxToday - rxConv;
  if (rxOpen >= 5) {
    out.push({
      id: "rx-open", kind: "performance", priority: rxOpen >= 15 && inSalesHours ? 1 : 2, affects: owned("Sales team", "Prescription uploads"),
      title: `${n0(rxOpen)} prescriptions uploaded today have no order yet (${n0(rxToday)} uploaded, ${n0(rxConv)} converted)`,
      evidence: [
        `Usual conversion of uploads by this time: ${rxRate.usual !== null ? pc1(rxRate.usual) : "—"}; today ${rxRate.today !== null ? pc1(rxRate.today) : "—"}.`,
        "Prescription uploads are not counted as New Sales until an order is placed; most conversions happen within a few hours of upload.",
      ],
      causes: [{ text: "Uploads waiting for a pharmacist / sales call or a price confirmation.", status: "hypothesis", confidence: "medium" }],
      levers: ["Prescription call-back speed"],
      action: "Sales team: call today's prescription uploads oldest first; quote price and delivery on the call.",
      impact: `Converting even a third of them adds about ${n0(rxOpen / 3)} New Sales today.`, followUp: "Uploads converted today, next refresh.", weight: 2.2e9 + rxOpen,
    });
  }

  // 8. Sales-team link and lead surge.
  const leads = w.paced("fresh_leads", "all", 7);
  const leadWeb = links.find((l) => l.key === "lead_web");
  if (inSalesHours && leads.significant && (leads.pace ?? 0) > 0 && leadWeb?.broken) {
    out.push({
      id: "leads-not-converting", kind: "performance", priority: 2, affects: owned("Sales team", "Lead → WEB order"),
      title: `Fresh cart leads ${pct(leads.pace!)} vs usual but WEB orders are not following (${pc1(leadWeb.today ?? 0)} per lead vs ${pc1(leadWeb.usual ?? 0)})`,
      evidence: [`${n0(leads.today)} Fresh leads vs ${n0(leads.usual ?? 0)} usual; WEB Fresh orders ${n0(web.today)} vs ${n0(web.usual ?? 0)}.`],
      causes: [{ text: "More leads than the team can call at the usual speed.", status: "hypothesis", confidence: "medium" }],
      levers: ["Agent allocation"], action: "Add callers to the cart queue for the next two hours; deprioritise winback calls.",
      impact: `At the usual lead → WEB rate, today's leads would give about ${n0((leadWeb.usual ?? 0) * leads.today)} WEB orders by now.`, followUp: "Lead → WEB order rate, next refresh.", weight: 1.5e9,
    });
  }

  // 9. Supply problems seen on calls.
  const mix = outcomeMix(w);
  const supply = mix.filter((m) => m.supply && m.today >= 3 && (m.change ?? 0) >= 0.03);
  if (supply.length) {
    out.push({
      id: "supply", kind: "performance", priority: 2, affects: owned("Ops · Supply", "Lost orders on calls"),
      title: `Calls today are losing orders to ${supply.map((m) => m.outcome.replace(/_/g, " ").toLowerCase()).join(", ")}`,
      evidence: supply.map((m) => `${m.outcome}: ${n0(m.today)} calls (${pc1(m.share ?? 0)} of today's connected calls vs ${pc1(m.usual_share ?? 0)} usual).`),
      causes: [{ text: "Stock-outs, branded-only requests, courier delays or price gaps on specific medicines.", status: "hypothesis", confidence: "medium" }],
      levers: ["Stock / substitutes", "Courier", "Price match"],
      action: "Ops: pull today's call notes for these outcomes, list the medicines named and fix stock or substitutes for the top three; share a substitute script with the sales team.",
      impact: "These are customers who wanted to order.", followUp: "Share of supply outcomes in today's calls.", weight: 1.2e9,
    });
  }

  // 10. Cancellations.
  const canc = w.paced("cancelled");
  if (canc.significant && (canc.pace ?? 0) > 0 && canc.today >= 5) {
    out.push({
      id: "cancel", kind: "performance", priority: 2, affects: owned("Ops · Supply", "Cancellations today"),
      title: `${n0(canc.today)} Fresh orders placed today are already cancelled vs ${n0(canc.usual ?? 0)} usual by now`,
      evidence: ["DELIVERY_CANCELED / THREE_PL_CANCELLED_ACKNOWLEDGEMENT on orders placed today; these are excluded from New Sales."],
      causes: [{ text: "Serviceability, stock or customer-initiated cancellations.", status: "hypothesis", confidence: "low" }],
      levers: ["Serviceability", "Stock"], action: "Ops: check cancellation reasons for today's orders and call back customers who cancelled for stock or delivery reasons.",
      impact: `${n0(canc.today - (canc.usual ?? 0))} more lost orders than a normal day.`, followUp: "Cancelled today vs usual.", weight: 9e8,
    });
  }

  // 11. Region mix drift.
  const t3share = div(t3.today, ns.today);
  const t3usual = div(t3.usual, ns.usual);
  if (t3share !== null && t3usual !== null && ns.today >= 15 && t3share - t3usual >= 0.1) {
    out.push({
      id: "tier3-drift", kind: "performance", priority: 3, affects: owned("Growth · Meta", "Region mix today"),
      title: `Tier 3 is ${pc1(t3share)} of New Sales today vs ${pc1(t3usual)} usual (${pts(t3share - t3usual)})`,
      evidence: [`Tier 3 ${n0(t3.today)}, Priority Mumbai ${n0(pm.today)}, MMR ${n0(mmr.today)} of ${n0(ns.today)} today.`],
      causes: [{ text: "Broad / state-wide ad sets delivering more today.", status: "hypothesis", confidence: "medium" }], levers: ["Ad set budget split"],
      action: "If Mumbai is the priority today, cap broad ad sets for the evening and keep Mumbai ad sets uncapped.",
      impact: "Keeps today's acquisition aligned with the Mumbai priority.", followUp: "Tier 3 share at end of day.", weight: 5e7,
    });
  }

  return out.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}
