// Meta Ads intelligence: period comparisons, trend annotations, creative classification and action insights.
// Pure (no I/O). Inputs are validated aggregates: adwatch ad × day rows, AppsFlyer Meta-attributed device counts,
// AppsFlyer by-ad-name installs / purchasers, and eligible Fresh orders.
//
// Hard limits encoded here: Meta receives no purchase or add-to-cart events, so nothing here claims Meta-attributed
// purchases, ROAS or creative → sale causation. Placement data is not ingested. Format is inferred from video views.
// Launch dates are inferred from the first day of delivery unless the business-supplied list confirms them.

import { addDays, daysBetween, formatDateShort, monthStart } from "../format/ist.ts";
import type { ActionInsight } from "./actionInsights.ts";
import { OCT_CREATIVES, creativeOf, type Cohort } from "./octCreatives.ts";
import type { AfAdDailyRow, MetaAdHistoryRow, OrdersDailyRow } from "../types/schemas";

export const ADWATCH_FROM = "2026-09-12";


// ---------- Totals and rates ----------

export interface MetaTotals {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  installs: number;
  video_3s: number;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  cpi: number | null;
  /** Installs ÷ link clicks: what happens after the click. */
  click_to_install: number | null;
  /** 3-second video views ÷ impressions (hook rate). */
  hook_rate: number | null;
}

const div = (n: number, d: number) => (d === 0 ? null : n / d);

export function totals(rows: readonly MetaAdHistoryRow[]): MetaTotals {
  const t = { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, installs: 0, video_3s: 0 };
  for (const r of rows) {
    t.spend += r.spend;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.link_clicks += r.link_clicks;
    t.installs += r.installs;
    t.video_3s += r.video_3s;
  }
  return withRates(t);
}

/** Rates from summed delivery counts. */
export function withRates(t: Pick<MetaTotals, "spend" | "impressions" | "clicks" | "link_clicks" | "installs" | "video_3s">): MetaTotals {
  return {
    ...t,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    ctr: div(t.link_clicks, t.impressions),
    cpc: div(t.spend, t.link_clicks),
    cpi: div(t.spend, t.installs),
    click_to_install: div(t.installs, t.link_clicks),
    hook_rate: div(t.video_3s, t.impressions),
  };
}

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;
const rowsIn = (rows: readonly MetaAdHistoryRow[], from: string, to: string) => rows.filter((r) => inRange(r.date, from, to));

// ---------- Periods ----------

export interface MetaPeriod {
  id: "today" | "day" | "last7" | "mtd" | "range";
  label: string;
  from: string;
  to: string;
  cmpLabel: string;
  cmpFrom: string;
  cmpTo: string;
  /** Current day still in progress: totals are not comparable with a full day; rates are. */
  partial: boolean;
}

/** Periods anchored to the end date of the date filter. When that is today, today is shown "so far". */
export function metaPeriods(anchor: string, today: string): MetaPeriod[] {
  const partial = anchor >= today;
  const last = partial ? addDays(anchor, -1) : anchor; // last complete day
  const span = (f: string, t: string) => (f === t ? formatDateShort(f) : `${formatDateShort(f)} – ${formatDateShort(t)}`);
  const out: MetaPeriod[] = [];
  if (partial) {
    out.push({ id: "today", label: `Today so far (${formatDateShort(anchor)})`, from: anchor, to: anchor, cmpLabel: `vs ${formatDateShort(last)} (full day)`, cmpFrom: last, cmpTo: last, partial: true });
  }
  out.push({
    id: "day",
    label: partial ? `Yesterday (${formatDateShort(last)})` : `${formatDateShort(last)} (end date)`,
    from: last,
    to: last,
    cmpLabel: `vs ${formatDateShort(addDays(last, -1))}`,
    cmpFrom: addDays(last, -1),
    cmpTo: addDays(last, -1),
    partial: false,
  });
  out.push({
    id: "last7",
    label: `Last 7 days (${span(addDays(last, -6), last)})`,
    from: addDays(last, -6),
    to: last,
    cmpLabel: `vs prior 7 days (${span(addDays(last, -13), addDays(last, -7))})`,
    cmpFrom: addDays(last, -13),
    cmpTo: addDays(last, -7),
    partial: false,
  });
  const mFrom = monthStart(last);
  const elapsed = daysBetween(mFrom, last);
  const pmFrom = monthStart(addDays(mFrom, -1));
  const pmEnd = addDays(mFrom, -1);
  const pmTo = addDays(pmFrom, elapsed - 1) > pmEnd ? pmEnd : addDays(pmFrom, elapsed - 1);
  out.push({
    id: "mtd",
    label: `Month to date (${span(mFrom, last)})`,
    from: mFrom,
    to: last,
    cmpLabel: `vs same ${elapsed} day${elapsed === 1 ? "" : "s"} last month (${span(pmFrom, pmTo)})`,
    cmpFrom: pmFrom,
    cmpTo: pmTo,
    partial: false,
  });
  return out;
}

export interface CompareWindow extends MetaPeriod {
  /** Column heading: Today / Yesterday / Last 7 days / MTD / Selected range. */
  short: string;
  /** The window's dates, e.g. "12 Oct – 18 Oct". */
  span: string;
}

const SHORT: Record<MetaPeriod["id"], string> = { today: "Today", day: "Yesterday", last7: "Last 7 days", mtd: "MTD", range: "Selected range" };

/**
 * The five windows every period comparison on the dashboard shows, side by side: today so far, yesterday, last 7
 * complete days, month to date (complete days) — all anchored to today in IST, independent of the date picker — plus
 * the selected date range vs the previous period of the same length.
 */
export function compareWindows(range: { from: string; to: string }, today: string): CompareWindow[] {
  const span = (f: string, t: string) => (f === t ? formatDateShort(f) : `${formatDateShort(f)} – ${formatDateShort(t)}`);
  const len = daysBetween(range.from, range.to);
  const cmpTo = addDays(range.from, -1);
  const cmpFrom = addDays(cmpTo, -(len - 1));
  const sel: MetaPeriod = {
    id: "range",
    label: `Selected range (${span(range.from, range.to)})`,
    from: range.from,
    to: range.to,
    cmpLabel: `vs previous ${len} day${len === 1 ? "" : "s"} (${span(cmpFrom, cmpTo)})`,
    cmpFrom,
    cmpTo,
    // Only a today-only range is "in progress"; a longer range ending today still compares with its previous period.
    partial: range.from >= today,
  };
  return [...metaPeriods(today, today), sel].map((p) => ({ ...p, short: SHORT[p.id], span: span(p.from, p.to) }));
}

export type MetricKey =
  | "spend" | "impressions" | "cpm" | "clicks" | "link_clicks" | "ctr" | "cpc" | "installs" | "cpi" | "click_to_install"
  | "hook_rate" | "af_installs" | "af_atc" | "cost_per_atc" | "new_sales" | "cac_fresh_order";

export interface PeriodMetricRow {
  key: MetricKey;
  label: string;
  format: "inr" | "inr_precise" | "count" | "pct";
  source: string;
  /** true = bigger is better (for colouring). */
  up: boolean;
  /** Totals cannot be compared for a partial day; rates can. */
  rate: boolean;
  value: number | null;
  cmp: number | null;
  abs: number | null;
  pct: number | null;
}

export interface PeriodBlock {
  period: MetaPeriod;
  rows: PeriodMetricRow[];
  /** AppsFlyer coverage starts 6 Oct 2026 — comparisons before that have no AppsFlyer data. */
  afComparable: boolean;
  /** adwatch coverage starts 12 Sep 2026 — a comparison window starting earlier is only partly covered. */
  metaComparable: boolean;
}

const METRIC_DEFS: Omit<PeriodMetricRow, "value" | "cmp" | "abs" | "pct">[] = [
  { key: "spend", label: "Spend", format: "inr", source: "Meta", up: false, rate: false },
  { key: "impressions", label: "Impressions", format: "count", source: "Meta", up: true, rate: false },
  { key: "cpm", label: "CPM", format: "inr_precise", source: "Meta", up: false, rate: true },
  { key: "clicks", label: "Clicks (all)", format: "count", source: "Meta", up: true, rate: false },
  { key: "link_clicks", label: "Link clicks", format: "count", source: "Meta", up: true, rate: false },
  { key: "ctr", label: "CTR (link)", format: "pct", source: "Meta", up: true, rate: true },
  { key: "cpc", label: "CPC (link)", format: "inr_precise", source: "Meta", up: false, rate: true },
  { key: "installs", label: "Installs (Meta-reported)", format: "count", source: "Meta", up: true, rate: false },
  { key: "cpi", label: "CPI", format: "inr_precise", source: "Meta", up: false, rate: true },
  { key: "click_to_install", label: "Click → install rate", format: "pct", source: "Meta", up: true, rate: true },
  { key: "hook_rate", label: "Hook rate (3-s video views ÷ impressions)", format: "pct", source: "Meta", up: true, rate: true },
  { key: "af_installs", label: "Installs (AppsFlyer, Meta-attributed)", format: "count", source: "AppsFlyer", up: true, rate: false },
  { key: "af_atc", label: "Add-to-cart devices (AppsFlyer, Meta-attributed)", format: "count", source: "AppsFlyer", up: true, rate: false },
  { key: "cost_per_atc", label: "Cost per add-to-cart device", format: "inr_precise", source: "Meta spend ÷ AppsFlyer", up: false, rate: true },
  { key: "new_sales", label: "New Sales (eligible Fresh orders, APP + WEB)", format: "count", source: "Orders", up: true, rate: false },
  { key: "cac_fresh_order", label: "CAC per Fresh order (all Meta spend)", format: "inr_precise", source: "Meta spend ÷ Orders", up: false, rate: true },
];

export const AF_COVERAGE_FROM = "2026-10-06";
/** First WHOLE day of AppsFlyer data (the first event is 6 Oct 2026, 17:00 IST) — the start for same-time-of-day cuts. */
export const AF_FIRST_FULL_DAY = "2026-10-07";

/** Eligible Fresh orders (APP + WEB) in a window, from the agreed orders_daily rows. */
export function newSales(orders: readonly OrdersDailyRow[] | null, from: string, to: string): number | null {
  if (!orders) return null;
  return orders.filter((r) => r.order_type === "Fresh" && inRange(r.order_date, from, to)).reduce((a, r) => a + r.orders, 0);
}

export function periodBlocks(
  history: readonly MetaAdHistoryRow[],
  periods: readonly MetaPeriod[],
  af: ReadonlyMap<string, { installs: number; atc: number }> | null,
  orders: readonly OrdersDailyRow[] | null,
): PeriodBlock[] {
  return periods.map((p) => {
    const cur = totals(rowsIn(history, p.from, p.to));
    const cmp = totals(rowsIn(history, p.cmpFrom, p.cmpTo));
    const afCur = af?.get(`${p.id}_cur`) ?? null;
    const afCmp = p.cmpFrom >= AF_COVERAGE_FROM ? (af?.get(`${p.id}_cmp`) ?? null) : null;
    const nsCur = newSales(orders, p.from, p.to);
    const nsCmp = newSales(orders, p.cmpFrom, p.cmpTo);
    const val = (t: MetaTotals, a: { installs: number; atc: number } | null, ns: number | null): Record<MetricKey, number | null> => ({
      spend: t.spend, impressions: t.impressions, cpm: t.cpm, clicks: t.clicks, link_clicks: t.link_clicks, ctr: t.ctr, cpc: t.cpc,
      installs: t.installs, cpi: t.cpi, click_to_install: t.click_to_install, hook_rate: t.hook_rate,
      af_installs: a ? a.installs : null, af_atc: a ? a.atc : null, cost_per_atc: a && a.atc ? t.spend / a.atc : null,
      new_sales: ns, cac_fresh_order: ns ? t.spend / ns : null,
    });
    const v = val(cur, afCur, nsCur);
    const c = val(cmp, afCmp, nsCmp);
    const rows = METRIC_DEFS.map((d) => {
      const value = v[d.key];
      const cmpV = c[d.key];
      // Totals need a full, equal comparison window; rates stay comparable over the covered days.
      const comparable = d.rate || (!p.partial && p.cmpFrom >= ADWATCH_FROM);
      return {
        ...d,
        value,
        cmp: cmpV,
        abs: comparable && value !== null && cmpV !== null ? value - cmpV : null,
        pct: comparable && value !== null && cmpV !== null && cmpV !== 0 ? (value - cmpV) / cmpV : null,
      };
    });
    return { period: p, rows, afComparable: p.cmpFrom >= AF_COVERAGE_FROM, metaComparable: p.cmpFrom >= ADWATCH_FROM };
  });
}

// ---------- Daily series and annotations ----------

export interface Marker {
  date: string;
  label: string;
}

export function dailySeries(history: readonly MetaAdHistoryRow[], dates: readonly string[]) {
  const byDate = new Map<string, MetaAdHistoryRow[]>();
  for (const r of history) {
    const b = byDate.get(r.date);
    if (b) b.push(r);
    else byDate.set(r.date, [r]);
  }
  return dates.map((date) => {
    const t = totals(byDate.get(date) ?? []);
    return { date, spend: t.spend, installs: t.installs, cpi: t.cpi };
  });
}

/** Spend jumps / drops of ≥ 35% vs the trailing 7-day average (needs 3+ prior days). */
export function spendMarkers(series: readonly { date: string; spend: number }[]): Marker[] {
  const out: Marker[] = [];
  series.forEach((d, i) => {
    const prior = series.slice(Math.max(0, i - 7), i).filter((x) => x.spend > 0);
    if (prior.length < 3) return;
    const avg = prior.reduce((a, x) => a + x.spend, 0) / prior.length;
    const ch = avg ? (d.spend - avg) / avg : 0;
    if (Math.abs(ch) >= 0.35) out.push({ date: d.date, label: `Spend ${ch > 0 ? "+" : ""}${Math.round(ch * 100)}%` });
  });
  return out.slice(-6);
}

/** CPI shifts of ≥ 40% vs the trailing 7-day CPI (days with ≥ 10 installs). */
export function cpiMarkers(series: readonly { date: string; spend: number; installs: number }[]): Marker[] {
  const out: Marker[] = [];
  series.forEach((d, i) => {
    if (d.installs < 10) return;
    const prior = series.slice(Math.max(0, i - 7), i);
    const s = prior.reduce((a, x) => a + x.spend, 0);
    const n = prior.reduce((a, x) => a + x.installs, 0);
    if (prior.length < 3 || n < 20) return;
    const ch = (d.spend / d.installs - s / n) / (s / n);
    if (Math.abs(ch) >= 0.4) out.push({ date: d.date, label: `CPI ${ch > 0 ? "+" : ""}${Math.round(ch * 100)}%` });
  });
  return out.slice(-6);
}

// ---------- Creatives ----------

export type CreativeClass =
  | "proven_winner"
  | "emerging"
  | "fatigue"
  | "high_spend_underperformer"
  | "cheap_weak_downstream"
  | "underperforming"
  | "steady"
  | "too_early";

export const CLASS_LABEL: Record<CreativeClass, string> = {
  proven_winner: "Proven winner",
  emerging: "Emerging — promising, not proven",
  fatigue: "Losing efficiency / fatigue",
  high_spend_underperformer: "High-spend underperformer",
  cheap_weak_downstream: "Cheap installs, weak downstream",
  underperforming: "Underperforming (CPI ≥ 25% above account)",
  steady: "Steady (near account CPI)",
  too_early: "Too early to judge",
};

export interface Creative {
  /** October list name, or the ad name for pre-October / mixed-creative ads. */
  key: string;
  name: string;
  cohort: Cohort;
  /** How the October list item was matched to Meta ad names. */
  match: string | null;
  ads: number;
  campaigns: string;
  format: string;
  launch: string;
  launchBasis: string;
  newThisMonth: boolean;
  daysLive: number;
  spend: number;
  spendShare: number | null;
  impressions: number;
  link_clicks: number;
  installs: number;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  cpi: number | null;
  hook_rate: number | null;
  cpi_vs_baseline: number | null;
  cpi_recent: number | null;
  cpi_prior: number | null;
  cpi_trend: number | null;
  ctr_trend: number | null;
  af_installs: number | null;
  af_purchasers: number | null;
  purchasers_per_install: number | null;
  cls: CreativeClass;
  reason: string;
}

export interface CreativeAnalysis {
  window: { from: string; to: string };
  recent: { from: string; to: string };
  prior: { from: string; to: string };
  baseline: MetaTotals & { purchasers_per_install: number | null };
  creatives: Creative[];
  formats: (MetaTotals & { format: string; creatives: number })[];
}

/** Minimum Meta installs before any CPI judgement is made. */
export const MIN_INSTALLS = 10;

export function analyseCreatives(
  history: readonly MetaAdHistoryRow[],
  afAds: readonly AfAdDailyRow[] | null,
  window: { from: string; to: string },
): CreativeAnalysis {
  const last = window.to;
  const recent = { from: addDays(last, -6), to: last };
  const prior = { from: addDays(last, -13), to: addDays(last, -7) };
  const keyOf = (r: MetaAdHistoryRow) => creativeOf(r.ad_name ?? r.ad_id ?? "").key;
  const firstSeen = new Map<string, string>();
  for (const r of history) {
    if (r.spend <= 0 && r.impressions <= 0) continue;
    const k = keyOf(r);
    if (!firstSeen.has(k) || r.date < firstSeen.get(k)!) firstSeen.set(k, r.date);
  }
  const win = rowsIn(history, window.from, window.to);
  const base = totals(win);
  const groups = new Map<string, MetaAdHistoryRow[]>();
  for (const r of win) {
    const b = groups.get(keyOf(r));
    if (b) b.push(r);
    else groups.set(keyOf(r), [r]);
  }
  const af = new Map<string, { installs: number; purchasers: number }>();
  for (const r of afAds ?? []) {
    if (!inRange(r.date, window.from, window.to)) continue;
    const k = creativeOf(r.ad_name).key;
    const a = af.get(k) ?? { installs: 0, purchasers: 0 };
    a.installs += r.installs;
    a.purchasers += r.purchasers;
    af.set(k, a);
  }
  const afTot = [...af.values()].reduce((s, a) => ({ i: s.i + a.installs, p: s.p + a.purchasers }), { i: 0, p: 0 });
  const basePpi = afAds && afTot.i ? afTot.p / afTot.i : null;
  const mStart = monthStart(last);

  const creatives: Creative[] = [...groups].map(([key, rows]) => {
    const t = totals(rows);
    const rec = totals(rowsIn(rows, recent.from, recent.to));
    const pri = totals(rowsIn(history.filter((r) => keyOf(r) === key), prior.from, prior.to));
    const id = creativeOf(rows[0].ad_name ?? rows[0].ad_id ?? "");
    const launch = firstSeen.get(key) ?? window.from;
    const launchBasis =
      id.cohort === "oct"
        ? "October launch (confirmed by list); day = first delivery"
        : id.cohort === "mixed"
          ? "Mixed-creative ad (several creatives in one ad)"
          : launch <= ADWATCH_FROM
            ? "Before October (not on Oct list); live before 12 Sep"
            : "Before October (not on Oct list); first delivery in this ad shown";
    const daysLive = daysBetween(launch, last);
    const a = af.get(key) ?? null;
    const ppi = a && a.installs ? a.purchasers / a.installs : null;
    const cpiVs = t.cpi !== null && base.cpi ? t.cpi / base.cpi - 1 : null;
    const share = base.spend ? t.spend / base.spend : null;
    const cpiTrend = rec.cpi !== null && pri.cpi !== null && rec.installs >= MIN_INSTALLS && pri.installs >= MIN_INSTALLS ? rec.cpi / pri.cpi - 1 : null;
    const ctrTrend = rec.ctr !== null && pri.ctr ? rec.ctr / pri.ctr - 1 : null;

    let cls: CreativeClass = "steady";
    let reason = "CPI within −15% / +25% of the account.";
    const enoughSpend = t.spend >= Math.max(1000, base.spend * 0.005);
    if (t.installs < MIN_INSTALLS || !enoughSpend) {
      cls = "too_early";
      reason = `Only ${t.installs} installs / ₹${Math.round(t.spend).toLocaleString("en-IN")} spend in the window — not enough to judge.`;
    } else if (share !== null && share >= 0.05 && cpiVs !== null && cpiVs >= 0.25) {
      cls = "high_spend_underperformer";
      reason = `${Math.round(share * 100)}% of spend at a CPI ${Math.round(cpiVs * 100)}% above the account.`;
    } else if (daysLive >= 14 && cpiTrend !== null && cpiTrend >= 0.25) {
      cls = "fatigue";
      reason = `CPI up ${Math.round(cpiTrend * 100)}% in the last 7 days vs the 7 before${ctrTrend !== null ? `; CTR ${ctrTrend >= 0 ? "+" : ""}${Math.round(ctrTrend * 100)}%` : ""}, after ${daysLive} days live.`;
    } else if (cpiVs !== null && cpiVs <= -0.15 && ppi !== null && basePpi !== null && a && a.installs >= 20 && ppi <= basePpi * 0.5) {
      cls = "cheap_weak_downstream";
      reason = `CPI ${Math.round(-cpiVs * 100)}% below the account, but AppsFlyer purchasers per install ${(ppi * 100).toFixed(1)}% vs ${(basePpi * 100).toFixed(1)}% for the account.`;
    } else if (cpiVs !== null && cpiVs <= -0.15 && t.installs >= 30 && daysLive >= 7 && !(ppi !== null && basePpi !== null && a && a.installs >= 20 && ppi < basePpi * 0.8)) {
      cls = "proven_winner";
      reason = `CPI ${Math.round(-cpiVs * 100)}% below the account on ${t.installs} installs over ${daysLive} days${ppi !== null ? `; downstream purchasers per install ${(ppi * 100).toFixed(1)}%` : ""}.`;
    } else if (cpiVs !== null && cpiVs <= -0.15 && daysLive <= 14) {
      cls = "emerging";
      reason = `CPI ${Math.round(-cpiVs * 100)}% below the account, but only ${t.installs} installs / ${daysLive} days live — needs ≥ 30 installs and 7 days before calling it.`;
    } else if (cpiVs !== null && cpiVs >= 0.25) {
      cls = "underperforming";
      reason = `CPI ${Math.round(cpiVs * 100)}% above the account on ${t.installs} installs (${share !== null ? `${(share * 100).toFixed(1)}% of spend` : ""}).`;
    }
    return {
      key,
      name: key,
      cohort: id.cohort,
      match: id.match,
      ads: new Set(rows.map((r) => r.ad_id)).size,
      campaigns: [...new Set(rows.map((r) => r.campaign_name ?? r.campaign_id ?? ""))].join(", "),
      format: id.format ?? (t.video_3s > 0 ? "Video (inferred)" : "Static (inferred)"),
      launch,
      launchBasis,
      newThisMonth: id.cohort === "oct" && launch >= mStart,
      daysLive,
      spend: t.spend,
      spendShare: share,
      impressions: t.impressions,
      link_clicks: t.link_clicks,
      installs: t.installs,
      cpm: t.cpm,
      ctr: t.ctr,
      cpc: t.cpc,
      cpi: t.cpi,
      hook_rate: t.video_3s > 0 ? t.hook_rate : null,
      cpi_vs_baseline: cpiVs,
      cpi_recent: rec.cpi,
      cpi_prior: pri.cpi,
      cpi_trend: cpiTrend,
      ctr_trend: ctrTrend,
      af_installs: a ? a.installs : null,
      af_purchasers: a ? a.purchasers : null,
      purchasers_per_install: ppi,
      cls,
      reason,
    };
  });

  const fmt = new Map<string, MetaAdHistoryRow[]>();
  for (const c of creatives) {
    const b = fmt.get(c.format) ?? [];
    b.push(...(groups.get(c.key) ?? []));
    fmt.set(c.format, b);
  }
  const formats = [...fmt].map(([format, rows]) => ({ format, creatives: creatives.filter((c) => c.format === format).length, ...totals(rows) }));

  return {
    window,
    recent,
    prior,
    baseline: { ...base, purchasers_per_install: basePpi },
    creatives: creatives.sort((a, b) => b.spend - a.spend),
    formats,
  };
}

// ---------- October creative cohort ----------

export interface CohortStats {
  group: string;
  live: number; // creatives with delivery in the window
  judged: number; // enough data to judge (not "too early")
  winners: number;
  emerging: number;
  struggling: number; // fatigue, high-spend underperformer, cheap installs / weak downstream
  winRate: number | null; // winners ÷ judged
  spend: number;
  installs: number;
  cpi: number | null;
}

export interface OctCohort {
  listed: number;
  liveOnMeta: number;
  notLive: string[];
  probableMatches: number;
  overall: CohortStats;
  byFormat: CohortStats[];
  /** Pre-October creatives in the same window, for context only (not part of the winning rate). */
  preOct: CohortStats;
}

function cohortStats(group: string, cs: readonly Creative[]): CohortStats {
  const judged = cs.filter((c) => c.cls !== "too_early");
  const winners = cs.filter((c) => c.cls === "proven_winner").length;
  const spend = cs.reduce((a, c) => a + c.spend, 0);
  const installs = cs.reduce((a, c) => a + c.installs, 0);
  return {
    group,
    live: cs.length,
    judged: judged.length,
    winners,
    emerging: cs.filter((c) => c.cls === "emerging").length,
    struggling: cs.filter((c) => c.cls === "fatigue" || c.cls === "high_spend_underperformer" || c.cls === "cheap_weak_downstream" || c.cls === "underperforming").length,
    winRate: judged.length ? winners / judged.length : null,
    spend,
    installs,
    cpi: installs ? spend / installs : null,
  };
}

/** Winning rate is measured on the October list only; pre-October and mixed-creative ads are excluded. */
export function octCohort(a: CreativeAnalysis): OctCohort {
  const oct = a.creatives.filter((c) => c.cohort === "oct");
  const live = new Set(oct.map((c) => c.key));
  const formats = [...new Set(oct.map((c) => c.format))].sort();
  return {
    listed: OCT_CREATIVES.length,
    liveOnMeta: live.size,
    notLive: OCT_CREATIVES.filter((o) => !live.has(o.name)).map((o) => o.name),
    probableMatches: oct.filter((c) => c.match === "probable").length,
    overall: cohortStats("All October creatives", oct),
    byFormat: formats.map((f) => cohortStats(f, oct.filter((c) => c.format === f))),
    preOct: cohortStats("Pre-October creatives (context)", a.creatives.filter((c) => c.cohort === "pre_oct")),
  };
}

// ---------- Table change signals ----------

export function changeSignal(cur: { spend: number; installs: number }, prev: { spend: number; installs: number } | undefined): string {
  if (!prev || prev.spend === 0) return cur.spend > 0 ? "New this period" : "";
  const cpiNow = cur.installs ? cur.spend / cur.installs : null;
  const cpiPrev = prev.installs ? prev.spend / prev.installs : null;
  if (cpiNow !== null && cpiPrev !== null && cur.installs >= MIN_INSTALLS && prev.installs >= MIN_INSTALLS) {
    const c = cpiNow / cpiPrev - 1;
    if (c >= 0.25) return `CPI rising (+${Math.round(c * 100)}%)`;
    if (c <= -0.2) return `CPI improving (${Math.round(c * 100)}%)`;
  }
  const s = cur.spend / prev.spend - 1;
  if (s >= 0.5) return `Spend scaling (+${Math.round(s * 100)}%)`;
  if (s <= -0.5) return `Spend cut (${Math.round(s * 100)}%)`;
  return "";
}

// ---------- Insights ----------

const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const chg = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b - 1);

export interface MetaInsightInput {
  recent: MetaTotals;
  prior: MetaTotals;
  afRecent: { installs: number; atc: number } | null;
  afPrior: { installs: number; atc: number } | null;
  salesRecent: number | null;
  salesPrior: number | null;
  creatives: CreativeAnalysis;
  placementAvailable: boolean;
  /** October creative cohort (winning rate is measured on October launches only). */
  cohort?: OctCohort | null;
}

export function metaInsights(x: MetaInsightInput): ActionInsight[] {
  const out: ActionInsight[] = [];
  const { recent: r, prior: p } = x;
  const window = "last 7 complete days vs the 7 before";

  // 1. CPI decomposition: CPI = CPM / 1000 ÷ (CTR × click→install). Log changes add up exactly.
  if (r.cpi && p.cpi && r.cpm && p.cpm && r.ctr && p.ctr && r.click_to_install && p.click_to_install && r.installs >= 30 && p.installs >= 30) {
    const dCpi = Math.log(r.cpi / p.cpi);
    if (Math.abs(dCpi) >= Math.log(1.1)) {
      const parts = [
        { name: "CPM (cost of reach)", v: Math.log(r.cpm / p.cpm), lever: "Audience / bid / placement mix" },
        { name: "CTR (creative pull)", v: -Math.log(r.ctr / p.ctr), lever: "Creative refresh and hooks" },
        { name: "click → install rate (store page / post-click)", v: -Math.log(r.click_to_install / p.click_to_install), lever: "App-store listing, deep link and landing flow" },
      ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
      const top = parts[0];
      out.push({
        id: "meta-cpi-decomposition",
        kind: "performance",
        priority: dCpi > 0 ? 1 : 3,
        affects: "CPI (Meta spend ÷ Meta-reported installs)",
        title: `CPI ${dCpi > 0 ? "rose" : "fell"} ${pct(Math.exp(dCpi) - 1)} (${inr(p.cpi)} → ${inr(r.cpi)}), mainly through ${top.name}`,
        evidence: [
          `CPM ${inr(p.cpm)} → ${inr(r.cpm)} (${pct(r.cpm / p.cpm - 1)}); CTR ${(p.ctr * 100).toFixed(2)}% → ${(r.ctr * 100).toFixed(2)}%; click → install ${(p.click_to_install * 100).toFixed(1)}% → ${(r.click_to_install * 100).toFixed(1)}% (${window}).`,
          `CPI = CPM ÷ 1,000 ÷ (CTR × click→install), so the three changes account for the CPI change exactly.`,
        ],
        causes: [{ text: `${top.name} moved the most.`, status: "confirmed", confidence: "high" }].concat(
          top.name.startsWith("CPM")
            ? [{ text: "Auction pressure or a narrower audience raised the cost of reach.", status: "hypothesis" as const, confidence: "medium" as const }]
            : top.name.startsWith("CTR")
              ? [{ text: "Creatives are wearing out or new ones hook less.", status: "hypothesis" as const, confidence: "medium" as const }]
              : [{ text: "Something after the click changed (store page, deep link, app size).", status: "hypothesis" as const, confidence: "medium" as const }],
        ) as ActionInsight["causes"],
        levers: [top.lever],
        action: top.name.startsWith("CPM")
          ? "Compare CPM by campaign and ad set for the two weeks; check audience overlap and frequency on the biggest spenders."
          : top.name.startsWith("CTR")
            ? "Check the creatives flagged as fatigued below and rotate in the emerging ones."
            : "Test the store listing and the ad → store deep link on a few devices; compare click → install by campaign.",
        impact: `At current installs, every ₹10 of CPI ≈ ${inr(r.installs * 10)} of spend per week.`,
        followUp: "CPI and its three drivers, weekly.",
        weight: Math.abs(r.spend - p.cpi * r.installs),
      });
    }
  }

  // 2. Spend vs installs / add-to-cart proportionality.
  const dSpend = chg(r.spend, p.spend);
  const dInst = chg(r.installs, p.installs);
  const dAtc = x.afRecent && x.afPrior ? chg(x.afRecent.atc, x.afPrior.atc) : null;
  if (dSpend !== null && dSpend >= 0.1 && dInst !== null && dInst < dSpend - 0.1) {
    out.push({
      id: "meta-spend-not-proportional",
      kind: "performance",
      priority: 1,
      affects: "Spend efficiency (installs and add-to-cart per ₹)",
      title: `Spend ${pct(dSpend)} but installs only ${pct(dInst)}${dAtc !== null ? ` and Meta add-to-cart devices ${pct(dAtc)}` : ""}`,
      evidence: [
        `Spend ${inr(p.spend)} → ${inr(r.spend)}; Meta installs ${n0(p.installs)} → ${n0(r.installs)} (${window}).`,
        dAtc !== null ? `AppsFlyer Meta-attributed add-to-cart devices ${n0(x.afPrior!.atc)} → ${n0(x.afRecent!.atc)}.` : "AppsFlyer add-to-cart for the prior week is not covered (data from 6 Oct).",
      ],
      causes: [{ text: "Extra budget went to auctions or creatives that convert worse (diminishing returns).", status: "hypothesis", confidence: "medium" }],
      levers: ["Budget allocation between campaigns", "Creative mix"],
      action: "Find which campaigns took the extra spend (Campaigns table, 'Spend scaling' signal) and compare their CPI with the rest before adding more.",
      impact: `At the prior week's CPI, the extra spend would have bought ≈ ${n0(r.spend / (p.cpi ?? Infinity) - r.installs)} more installs.`,
      followUp: "Installs per ₹1,000 spend, weekly.",
      weight: r.spend - p.spend,
    });
  }

  // 3. Meta vs New Sales divergence.
  const dSales = chg(x.salesRecent, x.salesPrior);
  const dCpi = chg(r.cpi, p.cpi);
  if (dSales !== null && dCpi !== null && ((dCpi <= -0.1 && dSales <= -0.1) || (dCpi >= 0.1 && dSales >= 0.1))) {
    const metaBetter = dCpi < 0;
    out.push({
      id: "meta-vs-new-sales",
      kind: "performance",
      priority: metaBetter ? 1 : 2,
      affects: "Meta efficiency vs actual New Sales",
      title: metaBetter
        ? `Meta got cheaper (CPI ${pct(dCpi)}) but New Sales fell ${pct(dSales)}`
        : `Meta got more expensive (CPI ${pct(dCpi)}) while New Sales rose ${pct(dSales)}`,
      evidence: [
        `New Sales (eligible Fresh orders, APP + WEB) ${n0(x.salesPrior!)} → ${n0(x.salesRecent!)} (${window}).`,
        "Meta has no purchase tracking, so this is a co-movement of two series, not attribution.",
      ],
      causes: metaBetter
        ? [{ text: "Cheaper installs are lower-intent users who do not order, or WEB / organic sales fell independently.", status: "hypothesis", confidence: "medium" }]
        : [{ text: "Sales are driven by WEB / organic / repeat demand rather than this week's Meta installs.", status: "hypothesis", confidence: "medium" }],
      levers: ["Optimisation event (install vs deeper event)", "Creative and audience quality"],
      action: metaBetter
        ? "Check the 'Cheap installs, weak downstream' creatives below and the App Funnel's install → add-to-cart step for the same week."
        : "Split New Sales into APP vs WEB on the Overview to see which channel moved.",
      impact: "Prevents scaling a channel on cheap installs that do not become customers.",
      followUp: "CAC per Fresh order and AppsFlyer Meta add-to-cart per install, weekly.",
      weight: Math.abs((x.salesRecent ?? 0) - (x.salesPrior ?? 0)) * 20,
    });
  }

  // 4–7. Creative findings.
  const by = (c: CreativeClass) => x.creatives.creatives.filter((k) => k.cls === c);
  const list = (cs: Creative[], k = 3) => cs.slice(0, k).map((c) => `${c.name} — CPI ${c.cpi !== null ? inr(c.cpi) : "—"}, ${n0(c.installs)} installs, ${inr(c.spend)} spend`);
  const baseCpi = x.creatives.baseline.cpi;
  const under = by("high_spend_underperformer");
  if (under.length && baseCpi) {
    const excess = under.reduce((a, c) => a + (c.spend - (c.installs * baseCpi)), 0);
    out.push({
      id: "meta-high-spend-underperformers",
      kind: "performance",
      priority: 1,
      affects: "Creative budget allocation",
      title: `${under.length} high-spend creative${under.length > 1 ? "s buy" : " buys"} installs ≥ 25% above the account CPI`,
      evidence: list(under).concat([`Account CPI in the window: ${inr(baseCpi)}.`]),
      causes: [{ text: "Budget stays on creatives after their efficiency drops (automatic delivery keeps spending).", status: "hypothesis", confidence: "medium" }],
      levers: ["Budget shift to proven winners", "Creative refresh"],
      action: "Cap or reduce budget on these creatives and move it to the proven winners listed below; review again after 7 days.",
      impact: `Spend above the account-CPI equivalent on these creatives: ≈ ${inr(excess)} in the window (not a forecast of savings).`,
      followUp: "Spend share and CPI of these creatives, weekly.",
      weight: excess / Math.max(baseCpi, 1),
    });
  }
  const fat = by("fatigue");
  if (fat.length) {
    out.push({
      id: "meta-creative-fatigue",
      kind: "performance",
      priority: 2,
      affects: "Creative efficiency over time",
      title: `${fat.length} creative${fat.length > 1 ? "s are" : " is"} losing efficiency (CPI up ≥ 25% week on week)`,
      evidence: fat.slice(0, 3).map((c) => `${c.name}: ${c.reason}`),
      causes: [{ text: "Audience saturation / creative wear-out.", status: "hypothesis", confidence: "medium" }],
      levers: ["Creative rotation", "Audience expansion"],
      action: "Prepare replacements for these creatives now; rotate them out once a replacement reaches the emerging stage.",
      impact: "Fatigued creatives keep spending at a rising CPI until rotated.",
      followUp: "Weekly CPI and CTR of each flagged creative.",
      weight: fat.reduce((a, c) => a + c.spend, 0) / Math.max(baseCpi ?? 1, 1) / 4,
    });
  }
  const em = by("emerging");
  if (em.length) {
    out.push({
      id: "meta-emerging-creatives",
      kind: "performance",
      priority: 2,
      affects: "Creative testing",
      title: `${em.length} emerging creative${em.length > 1 ? "s are" : " is"} beating the account CPI on early data`,
      evidence: em.slice(0, 3).map((c) => `${c.name}: ${c.reason}`),
      causes: [{ text: "Early signal only — small samples often regress towards the account average.", status: "hypothesis", confidence: "low" }],
      levers: ["Controlled budget increase", "Testing structure"],
      action: "Keep these live at steady budget until each has ≥ 30 installs and 7 days; then promote the ones still below the account CPI.",
      impact: "Lets winners prove themselves without over-spending on noise.",
      followUp: "Installs and CPI of each emerging creative until it reaches 30 installs.",
      weight: em.length * 5,
    });
  }
  const weak = by("cheap_weak_downstream");
  if (weak.length) {
    out.push({
      id: "meta-cheap-weak-downstream",
      kind: "performance",
      priority: 1,
      affects: "Install quality",
      title: `${weak.length} creative${weak.length > 1 ? "s bring" : " brings"} cheap installs that rarely purchase`,
      evidence: weak.slice(0, 3).map((c) => `${c.name}: ${c.reason}`),
      causes: [{ text: "The creative attracts low-intent users (e.g. curiosity or incentive clicks).", status: "hypothesis", confidence: "medium" }],
      levers: ["Creative message and offer", "Optimisation event"],
      action: "Do not scale these on CPI alone; compare their install → add-to-cart in AppsFlyer by ad name before the next budget change.",
      impact: "Cheap installs that do not buy raise CAC per Fresh order even when CPI looks good.",
      followUp: "AppsFlyer purchasers per install for these creatives, weekly.",
      weight: weak.reduce((a, c) => a + c.installs, 0) / 10,
    });
  }
  const win = by("proven_winner");
  if (win.length) {
    out.push({
      id: "meta-proven-winners",
      kind: "performance",
      priority: 3,
      affects: "Creative budget allocation",
      title: `${win.length} proven winner${win.length > 1 ? "s" : ""}: ≥ 15% below the account CPI with enough data`,
      evidence: list(win),
      causes: [{ text: "Sustained CPI advantage over ≥ 7 days and ≥ 30 installs.", status: "confirmed", confidence: "medium" }],
      levers: ["Budget allocation"],
      action: "Use these as the control in new creative tests and as the destination for budget moved off underperformers.",
      impact: "Shifting budget towards lower-CPI creatives lowers blended CPI at the same spend.",
      followUp: "Blended CPI and these creatives' spend share, weekly.",
      weight: 3,
    });
  }

  // October creative cohort: winning rate on October launches only.
  const co = x.cohort;
  if (co && co.overall.live > 0) {
    const fm = co.byFormat.filter((f) => f.judged > 0);
    const best = [...fm].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || (a.cpi ?? Infinity) - (b.cpi ?? Infinity))[0];
    const tooEarly = co.overall.live - co.overall.judged;
    out.push({
      id: "meta-oct-cohort",
      kind: "performance",
      priority: co.overall.winRate !== null && co.overall.winRate < 0.1 ? 1 : 2,
      affects: "October creative testing (winning rate)",
      title:
        co.overall.judged > 0
          ? `October creatives: ${co.overall.winners} of ${co.overall.judged} judged are proven winners (${Math.round((co.overall.winRate ?? 0) * 100)}% winning rate); ${tooEarly} still too early to judge`
          : `October creatives: none has enough data to judge yet (${co.overall.live} live)`,
      evidence: [
        `${co.liveOnMeta} of ${co.listed} listed October creatives have delivered on Meta; ${co.notLive.length} have not (offline artwork or not yet launched).`,
        ...fm.map((f) => `${f.group}: ${f.winners} winner(s) of ${f.judged} judged, ${f.emerging} emerging, ${f.struggling} struggling; CPI ${f.cpi !== null ? inr(f.cpi) : "—"} on ${n0(f.installs)} installs.`),
        `Pre-October creatives in the same window (context): CPI ${co.preOct.cpi !== null ? inr(co.preOct.cpi) : "—"} on ${n0(co.preOct.installs)} installs.`,
        co.probableMatches ? `${co.probableMatches} October creative(s) are matched to Meta ads by theme ("probable") — check the mapping table.` : "",
      ].filter(Boolean),
      causes: [
        { text: "Most October creatives received too little spend to reach 10+ installs, so they never got a fair test.", status: tooEarly > co.overall.judged ? "confirmed" : "hypothesis", confidence: "medium" },
        ...(best ? [{ text: `${best.group} creatives currently convert best among the judged October creatives.`, status: "hypothesis" as const, confidence: "low" as const }] : []),
      ],
      levers: ["Test budget per new creative", "Format mix (static vs video)"],
      action:
        tooEarly > co.overall.judged
          ? "Give each new October creative a minimum test budget (enough for ~30 installs at the account CPI) before judging it; retire only after that."
          : "Promote the October winners into the main campaigns and brief the next batch on what the winners share.",
      impact: "A fair test per creative is what turns the October batch into reliable winners instead of untested spend.",
      followUp: "October winning rate (winners ÷ judged) and share of October creatives with ≥ 30 installs, weekly.",
      weight: 8,
    });
  }

  // 8. Tracking / attribution.
  if (x.afRecent && r.installs > 0) {
    const ratio = x.afRecent.installs / r.installs;
    if (ratio < 0.7 || ratio > 1.3) {
      out.push({
        id: "meta-install-attribution-gap",
        kind: "tracking",
        priority: 3,
        affects: "Install counts (Meta-reported vs AppsFlyer)",
        title: `AppsFlyer attributes ${Math.round(ratio * 100)}% of Meta-reported installs to Meta (${n0(x.afRecent.installs)} vs ${n0(r.installs)})`,
        evidence: ["Meta counts installs with its own attribution (view-through and click windows); AppsFlyer de-duplicates across all paid sources."],
        causes: [{ text: "Different attribution windows and de-duplication — expected to differ, not an error by itself.", status: "confirmed", confidence: "medium" }],
        levers: ["Attribution settings"],
        action: "Use Meta-reported installs for in-platform optimisation and AppsFlyer for cross-channel comparison; do not add them together.",
        impact: "Avoids double-counting installs and over-crediting Meta.",
        followUp: "AppsFlyer ÷ Meta install ratio, weekly.",
        weight: 0.5,
      });
    }
  }
  if (!x.placementAvailable) {
    out.push({
      id: "meta-placement-gap",
      kind: "tracking",
      priority: 3,
      affects: "Placement analysis",
      title: "Placement / platform performance cannot be analysed: no current placement data",
      evidence: ["The only placement breakdown (Meta_AdSpent.ads_insights_platform_and_device) stopped loading on 14 Jul 2026 and is not readable by the dashboard."],
      causes: [{ text: "adwatch collects ad-level insights without the publisher_platform / platform_position breakdown.", status: "confirmed", confidence: "high" }],
      levers: ["Data collection"],
      action: "Add the publisher_platform and platform_position breakdowns to the adwatch Meta collector (a separate daily table), then this section can compare placements.",
      impact: "Placement is a common source of CPM and CPI differences; today it is invisible.",
      followUp: "Placement table populated for the last 7 days.",
      weight: 0.4,
    });
  }
  return out.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}
