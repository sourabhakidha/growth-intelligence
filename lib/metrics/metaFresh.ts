// Meta Ads → Fresh sales view-models: KPI strip, unified timeline, Fresh-user funnel, drop-off diagnostics, channel
// efficiency, campaign drivers, creative opportunity map, format performance and Fresh-sales insights. Pure (no I/O).
//
// Sources stay separate and labelled:
//   - Meta (adwatch.meta_ad_daily): spend, delivery, Meta-reported installs. Meta receives no purchase or add-to-cart
//     events, so nothing here is Meta purchase attribution and there is no ROAS.
//   - AppsFlyer (paid users only, from 6 Oct 2026): Meta-attributed Fresh add-to-cart / checkout USERS (agreed Fresh
//     rule), and the eligible Fresh orders those users placed (AppsFlyer user match to actual orders).
//   - CRM: Fresh abandoned-cart leads (written crm_025a rule; all sources, one per phone per IST day). Leads are not
//     cart events and not orders.
//   - Orders (Order_Level_V4): New Sales = eligible Fresh orders, APP + WEB, all channels; Fresh customers = distinct
//     userIDs over the window. Fresh-customer CAC = all Meta spend ÷ distinct Fresh customers (blended).

import { formatDateShort } from "../format/ist.ts";
import type { ActionInsight } from "./actionInsights.ts";
import { ADWATCH_FROM, AF_COVERAGE_FROM, totals, withRates, type Creative, type CreativeAnalysis, type MetaPeriod, type MetaTotals } from "./metaIntel.ts";
import type { AfCampaignDailyRow, CartLeadDailyRow, MetaAdHistoryRow, MetaAfRow, MetaSameTimeRow, OrdersDailyRow } from "../types/schemas";

const div = (n: number | null | undefined, d: number | null | undefined) => (n === null || n === undefined || !d ? null : n / d);
const chg = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b - 1);
const rowsIn = <T extends { date: string }>(rows: readonly T[], from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);

export type AfWindow = Omit<MetaAfRow, "level" | "key">;

/** AppsFlyer window ids requested by the page for each period. */
export const afWindowId = (period: string, which: "cur" | "cmp" | "fcur" | "fcmp") => `${period}_${which}`;

/** The part of a window covered by AppsFlyer (from 6 Oct 2026), or null when none of it is. */
export function afClip(from: string, to: string): { from: string; to: string } | null {
  const f = from < AF_COVERAGE_FROM ? AF_COVERAGE_FROM : from;
  return f > to ? null : { from: f, to };
}

export function sumFreshLeads(rows: readonly CartLeadDailyRow[] | null, from: string, to: string): number | null {
  if (!rows) return null;
  return rows.filter((r) => r.lead_date >= from && r.lead_date <= to).reduce((a, r) => a + r.fresh, 0);
}

export function sumFreshOrders(rows: readonly OrdersDailyRow[] | null, from: string, to: string, channel?: "APP" | "WEB"): number | null {
  if (!rows) return null;
  return rows.filter((r) => r.order_type === "Fresh" && r.order_date >= from && r.order_date <= to && (!channel || r.channel === channel)).reduce((a, r) => a + r.orders, 0);
}

// ---------- KPI strip ----------

export type KpiKey =
  | "spend" | "impressions" | "cpm" | "clicks" | "ctr" | "cpc" | "installs" | "cpi"
  | "fresh_atc" | "cost_per_fresh_atc" | "fresh_leads" | "new_sales" | "fresh_cac";

export interface KpiTile {
  key: KpiKey;
  label: string;
  sub: string;
  format: "inr" | "inr_precise" | "count" | "pct";
  source: string;
  /** true = bigger is better (colour of the change). */
  up: boolean;
  value: number | null;
  cmp: number | null;
  change: number | null;
  /** Why there is no comparison, when there is none. */
  noCmp: string | null;
  hint: string;
}

export interface WindowFacts {
  meta: MetaTotals;
  af: AfWindow | null;
  /** Meta spend over the AppsFlyer-covered part of the window (denominator partner for AppsFlyer counts). */
  afSpend: number | null;
  /** The AppsFlyer-covered part of the window, when it is shorter than the window. */
  afWindow: { from: string; to: string } | null;
  leads: number | null;
  newSales: number | null;
  newSalesApp: number | null;
  freshCustomers: number | null;
}

export function windowFacts(
  history: readonly MetaAdHistoryRow[],
  from: string,
  to: string,
  af: AfWindow | null,
  leads: readonly CartLeadDailyRow[] | null,
  orders: readonly OrdersDailyRow[] | null,
  freshCustomers: number | null,
): WindowFacts {
  const clip = afClip(from, to);
  return {
    meta: totals(rowsIn(history, from, to)),
    af: clip ? af : null,
    afSpend: clip ? totals(rowsIn(history, clip.from, clip.to)).spend : null,
    afWindow: clip && clip.from !== from ? clip : null,
    leads: sumFreshLeads(leads, from, to),
    newSales: sumFreshOrders(orders, from, to),
    newSalesApp: sumFreshOrders(orders, from, to, "APP"),
    freshCustomers,
  };
}

/**
 * Window facts from same-time day rows (each day counted only to the current time): the per-day average over `days`,
 * so today, yesterday and the 7-day / MTD averages sit on one scale. AppsFlyer figures (meta_af "st" rows) average over
 * the days AppsFlyer covers, with Meta spend over those same days as their cost partner. Null when no day is present.
 */
export function sameTimeFacts(rows: readonly MetaSameTimeRow[], afDays: readonly MetaAfRow[] | null, days: readonly string[]): WindowFacts | null {
  const set = new Set(days);
  const rs = rows.filter((r) => set.has(r.day));
  if (!rs.length) return null;
  const avg = <T,>(xs: readonly T[], f: (r: T) => number) => xs.reduce((a, r) => a + f(r), 0) / xs.length;
  const afBy = new Map((afDays ?? []).filter((r) => r.level === "st").map((r) => [r.key, r]));
  const covered = rs.filter((r) => afBy.has(r.day));
  const afRows = covered.map((r) => afBy.get(r.day)!);
  const a = (f: (r: MetaAfRow) => number) => avg(afRows, f);
  return {
    meta: withRates({
      spend: avg(rs, (r) => r.spend),
      impressions: avg(rs, (r) => r.impressions),
      clicks: avg(rs, (r) => r.clicks),
      link_clicks: avg(rs, (r) => r.link_clicks),
      installs: avg(rs, (r) => r.installs),
      video_3s: avg(rs, (r) => r.video_3s),
    }),
    af: afRows.length
      ? {
          installs: a((r) => r.installs),
          atc: a((r) => r.atc),
          atc_fresh: a((r) => r.atc_fresh),
          checkout_fresh: a((r) => r.checkout_fresh),
          fresh_orders: a((r) => r.fresh_orders),
          fresh_orders_app: a((r) => r.fresh_orders_app),
          fresh_customers: a((r) => r.fresh_customers),
          atc_fresh_buyers: a((r) => r.atc_fresh_buyers),
        }
      : null,
    afSpend: covered.length ? avg(covered, (r) => r.spend) : null,
    afWindow: covered.length && covered.length < rs.length ? { from: covered[0].day, to: covered[covered.length - 1].day } : null,
    leads: avg(rs, (r) => r.fresh_leads),
    newSales: avg(rs, (r) => r.new_sales),
    newSalesApp: avg(rs, (r) => r.new_sales_app),
    freshCustomers: avg(rs, (r) => r.fresh_customers),
  };
}

/** Every KPI's value for a window (the tiles' measures, without comparison). */
export function kpiValues(f: WindowFacts): { key: KpiKey; value: number | null }[] {
  return KPI_DEFS.map((d) => ({ key: d.key, value: kpiValue(d.key, f) }));
}

const KPI_DEFS: Omit<KpiTile, "value" | "cmp" | "change" | "noCmp">[] = [
  { key: "spend", label: "Spend", sub: "Meta", format: "inr", source: "Meta", up: false, hint: "Meta-reported spend, all campaigns." },
  { key: "impressions", label: "Impressions", sub: "Meta", format: "count", source: "Meta", up: true, hint: "Meta-reported impressions." },
  { key: "cpm", label: "CPM", sub: "per 1,000 impr.", format: "inr_precise", source: "Meta", up: false, hint: "Spend ÷ impressions × 1,000." },
  { key: "clicks", label: "Clicks", sub: "link clicks", format: "count", source: "Meta", up: true, hint: "Meta link clicks (clicks to the store / app)." },
  { key: "ctr", label: "CTR", sub: "link", format: "pct", source: "Meta", up: true, hint: "Link clicks ÷ impressions." },
  { key: "cpc", label: "CPC", sub: "link", format: "inr_precise", source: "Meta", up: false, hint: "Spend ÷ link clicks." },
  { key: "installs", label: "Installs", sub: "Meta-reported", format: "count", source: "Meta", up: true, hint: "Meta-reported mobile app installs (Meta's own attribution)." },
  { key: "cpi", label: "CPI", sub: "Meta", format: "inr_precise", source: "Meta", up: false, hint: "Spend ÷ Meta-reported installs." },
  { key: "fresh_atc", label: "Fresh Add to Carts", sub: "AppsFlyer, Meta users", format: "count", source: "AppsFlyer", up: true, hint: "Distinct Meta-attributed AppsFlyer users whose first add-to-cart in the window came before any COMPLETED order (agreed Fresh rule). Coverage from 6 Oct 2026." },
  { key: "cost_per_fresh_atc", label: "Cost per Fresh ATC", sub: "Meta spend ÷ AppsFlyer", format: "inr_precise", source: "Meta ÷ AppsFlyer", up: false, hint: "All Meta spend ÷ Fresh Add to Carts." },
  { key: "fresh_leads", label: "Fresh Abandoned Cart Leads", sub: "CRM, all sources", format: "count", source: "CRM", up: false, hint: "Agreed crm_025a definition: cart leads, one per phone per IST day, no recycled re-runs or merged duplicates; Fresh = no COMPLETED order before the lead. All sources, not only Meta." },
  { key: "new_sales", label: "New Sales", sub: "Fresh orders, APP + WEB", format: "count", source: "Orders", up: true, hint: "Eligible Fresh orders (excludes PRESCRIPTION_UPLOADED, DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT), APP + WEB, all channels — not attributed to Meta." },
  { key: "fresh_cac", label: "Meta CAC", sub: "per Fresh customer", format: "inr_precise", source: "Meta ÷ Orders", up: false, hint: "All Meta spend ÷ distinct Fresh customers (all channels). Blended: not every Fresh customer came from Meta." },
];

function kpiValue(k: KpiKey, f: WindowFacts): number | null {
  const m = f.meta;
  switch (k) {
    case "spend": return m.spend;
    case "impressions": return m.impressions;
    case "cpm": return m.cpm;
    case "clicks": return m.link_clicks;
    case "ctr": return m.ctr;
    case "cpc": return m.cpc;
    case "installs": return m.installs;
    case "cpi": return m.cpi;
    case "fresh_atc": return f.af ? f.af.atc_fresh : null;
    case "cost_per_fresh_atc": return f.af ? div(f.afSpend, f.af.atc_fresh) : null;
    case "fresh_leads": return f.leads;
    case "new_sales": return f.newSales;
    case "fresh_cac": return div(m.spend, f.freshCustomers);
  }
}

const RATE_KEYS: ReadonlySet<KpiKey> = new Set(["cpm", "ctr", "cpc", "cpi", "cost_per_fresh_atc", "fresh_cac"]);
const AF_KEYS: ReadonlySet<KpiKey> = new Set(["fresh_atc", "cost_per_fresh_atc"]);

export function kpiStrip(p: MetaPeriod, cur: WindowFacts, cmp: WindowFacts): KpiTile[] {
  return KPI_DEFS.map((d) => {
    const value = kpiValue(d.key, cur);
    const c = kpiValue(d.key, cmp);
    const rate = RATE_KEYS.has(d.key);
    let noCmp: string | null = null;
    if (AF_KEYS.has(d.key) && p.cmpFrom < AF_COVERAGE_FROM) noCmp = "no AppsFlyer data for the comparison (from 6 Oct)";
    else if (!rate && p.partial) noCmp = "day in progress";
    else if (p.cmpFrom < ADWATCH_FROM && (d.key === "fresh_cac" || (!rate && d.source.startsWith("Meta")))) noCmp = "comparison starts before Meta data (12 Sep)";
    else if (d.key === "fresh_leads" && !c) noCmp = "no CRM leads loaded for the comparison";
    return { ...d, value, cmp: noCmp ? null : c, change: noCmp ? null : chg(value, c), noCmp };
  });
}

// ---------- Unified timeline ----------

export interface TimelineEvent {
  date: string;
  kind: "campaign_start" | "campaign_stop" | "creative" | "spend_shift";
  label: string;
}

export interface TimelinePoint {
  date: string;
  spend: number;
  cpi: number | null;
  fresh_atc: number | null;
  new_sales: number;
}

export function timeline(
  history: readonly MetaAdHistoryRow[],
  dates: readonly string[],
  afDays: readonly MetaAfRow[] | null,
  orders: readonly OrdersDailyRow[] | null,
): TimelinePoint[] {
  const af = new Map((afDays ?? []).filter((r) => r.level === "day").map((r) => [r.key, r]));
  return dates.map((date) => {
    const t = totals(rowsIn(history, date, date));
    return {
      date,
      spend: Math.round(t.spend),
      cpi: t.installs >= 5 ? Math.round(t.spend / t.installs) : null,
      fresh_atc: afDays && date >= AF_COVERAGE_FROM ? (af.get(date)?.atc_fresh ?? 0) : null,
      new_sales: sumFreshOrders(orders, date, date) ?? 0,
    };
  });
}

/**
 * Changes the data can prove: a campaign's first and last day of delivery (from adwatch, which starts 12 Sep 2026),
 * plus creative launches and spend shifts passed in by the caller. Budget edits are not in any readable source.
 */
export function campaignEvents(history: readonly MetaAdHistoryRow[], from: string, to: string, lastComplete: string): TimelineEvent[] {
  const span = new Map<string, { name: string; first: string; last: string; spend: number }>();
  for (const r of history) {
    if (r.spend <= 0) continue;
    const id = r.campaign_id;
    const s = span.get(id) ?? { name: r.campaign_name ?? id, first: r.date, last: r.date, spend: 0 };
    if (r.date < s.first) s.first = r.date;
    if (r.date > s.last) s.last = r.date;
    s.spend += r.spend;
    span.set(id, s);
  }
  const total = [...span.values()].reduce((a, s) => a + s.spend, 0);
  const out: TimelineEvent[] = [];
  for (const s of span.values()) {
    if (s.spend < total * 0.01) continue;
    const short = shortCampaign(s.name);
    if (s.first > ADWATCH_FROM && s.first >= from && s.first <= to) out.push({ date: s.first, kind: "campaign_start", label: `Campaign live: ${short}` });
    if (s.last < lastComplete && s.last >= from && s.last <= to) out.push({ date: s.last, kind: "campaign_stop", label: `Last delivery: ${short}` });
  }
  return out;
}

/** "MI_AKIDHA_Meta_APP_ABO_Creative_Test_220926" → "ABO Creative Test 220926". */
export function shortCampaign(name: string): string {
  return name.replace(/^MI_AKIDHA_Meta_(APP|App)_/i, "").replace(/_/g, " ");
}

// ---------- Fresh-user funnel ----------

export interface FunnelStep {
  key: string;
  label: string;
  source: "Meta" | "AppsFlyer" | "Orders";
  value: number | null;
  prev: number | null;
  /** value ÷ previous step (same window). */
  conv: number | null;
  conv_prev: number | null;
  /** Change in conversion vs the comparison window, in percentage points. */
  conv_change_pts: number | null;
  /** Users lost from the previous step. */
  drop: number | null;
  drop_rate: number | null;
  /** Change in drop-off rate vs comparison, in points (positive = losing more). */
  drop_change_pts: number | null;
}

export interface FunnelView {
  window: { from: string; to: string };
  cmpWindow: { from: string; to: string } | null;
  steps: FunnelStep[];
  /** Context, never a funnel step: different populations. */
  checkout: number | null;
  checkoutPrev: number | null;
  metaUserOrders: number | null;
  metaUserOrdersApp: number | null;
  leads: number | null;
  leadsPrev: number | null;
  newSales: number | null;
  newSalesApp: number | null;
  /** Share of all New Sales placed by Meta-attributed AppsFlyer users. */
  metaShareOfNewSales: number | null;
}

export function freshFunnel(window: { from: string; to: string }, cmpWindow: { from: string; to: string } | null, cur: WindowFacts, cmp: WindowFacts | null): FunnelView {
  const raw: { key: string; label: string; source: FunnelStep["source"]; v: (f: WindowFacts) => number | null }[] = [
    { key: "impressions", label: "Impressions", source: "Meta", v: (f) => f.meta.impressions },
    { key: "clicks", label: "Link clicks", source: "Meta", v: (f) => f.meta.link_clicks },
    { key: "installs", label: "Installs (Meta-reported)", source: "Meta", v: (f) => f.meta.installs },
    { key: "fresh_atc", label: "Fresh Add to Carts", source: "AppsFlyer", v: (f) => f.af?.atc_fresh ?? null },
    { key: "fresh_buyers", label: "Fresh ATC users who ordered", source: "Orders", v: (f) => f.af?.atc_fresh_buyers ?? null },
  ];
  const steps: FunnelStep[] = raw.map((s, i) => {
    const value = s.v(cur);
    const prev = cmp ? s.v(cmp) : null;
    const before = i ? raw[i - 1] : null;
    const conv = before ? div(value, before.v(cur)) : null;
    const convPrev = before && cmp ? div(prev, before.v(cmp)) : null;
    const bv = before ? before.v(cur) : null;
    return {
      key: s.key,
      label: s.label,
      source: s.source,
      value,
      prev,
      conv,
      conv_prev: convPrev,
      conv_change_pts: conv !== null && convPrev !== null ? conv - convPrev : null,
      drop: bv !== null && value !== null ? bv - value : null,
      drop_rate: conv === null ? null : 1 - conv,
      drop_change_pts: conv !== null && convPrev !== null ? convPrev - conv : null,
    };
  });
  return {
    window,
    cmpWindow,
    steps,
    checkout: cur.af?.checkout_fresh ?? null,
    checkoutPrev: cmp?.af?.checkout_fresh ?? null,
    metaUserOrders: cur.af?.fresh_orders ?? null,
    metaUserOrdersApp: cur.af?.fresh_orders_app ?? null,
    leads: cur.leads,
    leadsPrev: cmp?.leads ?? null,
    newSales: cur.newSales,
    newSalesApp: cur.newSalesApp,
    metaShareOfNewSales: cur.af ? div(cur.af.fresh_orders, cur.newSales) : null,
  };
}

// ---------- Channel efficiency (cost per outcome) ----------

export interface EfficiencyRow {
  key: string;
  label: string;
  cur: number | null;
  prev: number | null;
  change: number | null;
  note: string;
}

/** `metaComparable` = the comparison window starts on or after adwatch coverage (12 Sep 2026), so its spend is complete. */
export function efficiency(cur: WindowFacts, cmp: WindowFacts | null, metaComparable = true): EfficiencyRow[] {
  const rows: { key: string; label: string; v: (f: WindowFacts) => number | null; note: string }[] = [
    { key: "cpi", label: "CPI", v: (f) => f.meta.cpi, note: "Meta spend ÷ Meta installs" },
    { key: "atc", label: "Cost per Fresh ATC", v: (f) => (f.af ? div(f.afSpend, f.af.atc_fresh) : null), note: "Meta spend ÷ AppsFlyer Fresh ATC users" },
    { key: "lead", label: "Cost per Fresh Lead", v: (f) => div(f.meta.spend, f.leads), note: "Meta spend ÷ CRM Fresh cart leads (all sources)" },
    { key: "meta_sale", label: "Cost per Meta-user Fresh order", v: (f) => (f.af ? div(f.afSpend, f.af.fresh_orders) : null), note: "Meta spend ÷ Fresh orders by Meta-attributed AppsFlyer users" },
    { key: "cac", label: "CAC (Fresh customer)", v: (f) => div(f.meta.spend, f.freshCustomers), note: "Meta spend ÷ all distinct Fresh customers (blended)" },
  ];
  return rows.map((r) => {
    const c = r.v(cur);
    // Whole-window spend over a partly covered comparison window understates cost; CPI and AppsFlyer rows use covered days.
    const raw = cmp && (metaComparable || r.key === "cpi" || r.key === "atc" || r.key === "meta_sale") ? r.v(cmp) : null;
    const p = raw ? raw : null;
    return { key: r.key, label: r.label, cur: c, prev: p, change: chg(c, p), note: r.note };
  });
}

// ---------- Campaign drivers ----------

/** AppsFlyer fields are null (not zero) when the AppsFlyer campaign report could not be read. */
export interface CampaignDriver {
  name: string;
  short: string;
  spend: number;
  spend_prev: number;
  spend_delta: number;
  /** Share of the account's absolute spend change. */
  spend_delta_share: number | null;
  installs: number;
  cpi: number | null;
  af_atc: number | null;
  af_atc_prev: number | null;
  af_atc_change: number | null;
  af_first_purchasers: number | null;
  af_first_purchasers_prev: number | null;
  af_fp_change: number | null;
  cost_per_af_fp: number | null;
  cost_per_af_fp_prev: number | null;
  cac_change: number | null;
  driver: string;
}

export function campaignDrivers(
  history: readonly MetaAdHistoryRow[],
  afCampaigns: readonly AfCampaignDailyRow[] | null,
  cur: { from: string; to: string },
  cmp: { from: string; to: string },
): CampaignDriver[] {
  const meta = (w: { from: string; to: string }) => {
    const m = new Map<string, { spend: number; installs: number }>();
    for (const r of rowsIn(history, w.from, w.to)) {
      const k = r.campaign_name ?? r.campaign_id;
      const v = m.get(k) ?? { spend: 0, installs: 0 };
      v.spend += r.spend;
      v.installs += r.installs;
      m.set(k, v);
    }
    return m;
  };
  const af = (w: { from: string; to: string }) => {
    const m = new Map<string, { atc: number; fp: number }>();
    for (const r of rowsIn(afCampaigns ?? [], w.from, w.to)) {
      const v = m.get(r.campaign_name) ?? { atc: 0, fp: 0 };
      v.atc += r.atc_users;
      v.fp += r.first_purchasers;
      m.set(r.campaign_name, v);
    }
    return m;
  };
  const mc = meta(cur);
  const mp = meta(cmp);
  const ac = af(cur);
  const ap = af(cmp);
  const names = [...new Set([...mc.keys(), ...mp.keys()])];
  const totalDelta = names.reduce((a, n) => a + Math.abs((mc.get(n)?.spend ?? 0) - (mp.get(n)?.spend ?? 0)), 0);
  return names
    .map((name) => {
      const c = mc.get(name) ?? { spend: 0, installs: 0 };
      const p = mp.get(name) ?? { spend: 0, installs: 0 };
      const a = ac.get(name) ?? { atc: 0, fp: 0 };
      const b = ap.get(name) ?? { atc: 0, fp: 0 };
      const has = afCampaigns !== null;
      const cac = has ? div(c.spend, a.fp) : null;
      const cacPrev = has ? div(p.spend, b.fp) : null;
      const delta = c.spend - p.spend;
      const cacChange = chg(cac, cacPrev);
      const driver =
        p.spend === 0 && c.spend > 0
          ? "New in this period"
          : c.spend === 0
            ? "Stopped"
            : cacChange !== null && cacChange >= 0.25 && a.fp >= 5
              ? "CAC rising"
              : cacChange !== null && cacChange <= -0.2 && a.fp >= 5
                ? "CAC improving"
                : chg(c.spend, p.spend) !== null && chg(c.spend, p.spend)! >= 0.3
                  ? "Scaling"
                  : chg(c.spend, p.spend) !== null && chg(c.spend, p.spend)! <= -0.3
                    ? "Cut back"
                    : "";
      return {
        name,
        short: shortCampaign(name),
        spend: c.spend,
        spend_prev: p.spend,
        spend_delta: delta,
        spend_delta_share: totalDelta ? Math.abs(delta) / totalDelta : null,
        installs: c.installs,
        cpi: div(c.spend, c.installs),
        af_atc: has ? a.atc : null,
        af_atc_prev: has ? b.atc : null,
        af_atc_change: has ? chg(a.atc, b.atc) : null,
        af_first_purchasers: has ? a.fp : null,
        af_first_purchasers_prev: has ? b.fp : null,
        af_fp_change: has ? chg(a.fp, b.fp) : null,
        cost_per_af_fp: cac,
        cost_per_af_fp_prev: cacPrev,
        cac_change: cacChange,
        driver,
      };
    })
    .filter((r) => r.spend > 0 || r.spend_prev > 0)
    .sort((x, y) => Math.abs(y.spend_delta) - Math.abs(x.spend_delta) || y.spend - x.spend);
}

// ---------- Creative opportunity map and formats ----------

export type OpportunityGroup = "winner" | "emerging" | "underperformer" | "steady" | "insufficient";

export const OPPORTUNITY_LABEL: Record<OpportunityGroup, string> = {
  winner: "Proven winner (scale)",
  emerging: "Emerging (test more)",
  underperformer: "Underperformer (fix or replace)",
  steady: "Steady",
  insufficient: "Insufficient data",
};

export function opportunityOf(c: Creative): OpportunityGroup {
  switch (c.cls) {
    case "proven_winner": return "winner";
    case "emerging": return "emerging";
    case "too_early": return "insufficient";
    case "steady": return "steady";
    default: return "underperformer";
  }
}

export interface OpportunityPoint {
  name: string;
  group: OpportunityGroup;
  spend: number;
  cpi: number | null;
  installs: number;
  af_purchasers: number | null;
  /** AppsFlyer purchasers per 100 AppsFlyer installs (by ad name). */
  purchasers_per_100: number | null;
  cost_per_af_purchaser: number | null;
  reason: string;
}

export function opportunityMap(a: CreativeAnalysis): OpportunityPoint[] {
  return a.creatives
    .filter((c) => c.spend > 0)
    .map((c) => ({
      name: c.name,
      group: opportunityOf(c),
      spend: Math.round(c.spend),
      cpi: c.cpi !== null ? Math.round(c.cpi) : null,
      installs: c.installs,
      af_purchasers: c.af_purchasers,
      purchasers_per_100: c.purchasers_per_install !== null ? Math.round(c.purchasers_per_install * 1000) / 10 : null,
      cost_per_af_purchaser: c.af_purchasers ? Math.round(c.spend / c.af_purchasers) : null,
      reason: c.reason,
    }));
}

/** Static / Video / UGC: UGC is read from the ad or list name; Video vs Static from the list or inferred from video views. */
export function formatOf(c: Creative): string {
  if (/ugc/i.test(c.name)) return "UGC video";
  if (c.format.startsWith("Video")) return c.format.includes("inferred") ? "Video (inferred)" : "Brand video";
  if (c.cohort === "mixed") return "Flexible / multi-creative";
  return c.format.startsWith("Static") ? (c.format.includes("inferred") ? "Static (inferred)" : "Static image") : c.format;
}

export interface FormatRow {
  format: string;
  creatives: number;
  spend: number;
  spend_share: number | null;
  installs: number;
  cpi: number | null;
  ctr: number | null;
  af_purchasers: number | null;
  cost_per_af_purchaser: number | null;
}

export function formatPerformance(a: CreativeAnalysis): FormatRow[] {
  const by = new Map<string, Creative[]>();
  for (const c of a.creatives) {
    const f = formatOf(c);
    by.set(f, [...(by.get(f) ?? []), c]);
  }
  const total = a.creatives.reduce((s, c) => s + c.spend, 0);
  return [...by]
    .map(([format, cs]) => {
      const spend = cs.reduce((s, c) => s + c.spend, 0);
      const installs = cs.reduce((s, c) => s + c.installs, 0);
      const imps = cs.reduce((s, c) => s + c.impressions, 0);
      const clicks = cs.reduce((s, c) => s + c.link_clicks, 0);
      const known = cs.filter((c) => c.af_purchasers !== null);
      const purch = known.length ? known.reduce((s, c) => s + (c.af_purchasers ?? 0), 0) : null;
      return {
        format,
        creatives: cs.length,
        spend: Math.round(spend),
        spend_share: div(spend, total),
        installs,
        cpi: div(spend, installs),
        ctr: div(clicks, imps),
        af_purchasers: purch,
        cost_per_af_purchaser: purch ? spend / purch : null,
      };
    })
    .sort((x, y) => y.spend - x.spend);
}

// ---------- Fresh-sales insights ----------

const pctS = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pp`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

export interface FreshInsightInput {
  periodLabel: string;
  funnel: FunnelView;
  cur: WindowFacts;
  cmp: WindowFacts | null;
  /** Comparison window is fully covered by AppsFlyer. */
  afComparable: boolean;
  /** Comparison window starts on or after adwatch coverage (12 Sep 2026), so its spend is complete. */
  metaComparable: boolean;
  drivers: CampaignDriver[];
  formats: FormatRow[];
}

export function freshInsights(x: FreshInsightInput): ActionInsight[] {
  const out: ActionInsight[] = [];
  const { cur, cmp, funnel } = x;
  const w = `${formatDateShort(funnel.window.from)} – ${formatDateShort(funnel.window.to)}`;

  // 1. Largest worsening funnel step (conversion, comparable windows only).
  const worse = funnel.steps.filter((s) => s.drop_change_pts !== null && s.key !== "clicks").sort((a, b) => (b.drop_change_pts ?? 0) - (a.drop_change_pts ?? 0))[0];
  if (worse && worse.drop_change_pts !== null && worse.drop_change_pts >= 0.01 && worse.conv !== null && worse.conv_prev !== null) {
    const idx = funnel.steps.indexOf(worse);
    const from = funnel.steps[idx - 1];
    const fresh = funnel.steps.find((s) => s.key === "fresh_buyers");
    const lostAtNext = from.value !== null ? from.value * (worse.conv_prev - worse.conv) : null;
    out.push({
      id: "fresh-funnel-drop",
      kind: "performance",
      priority: worse.drop_change_pts >= 0.03 ? 1 : 2,
      affects: `${from.label} → ${worse.label}`,
      title: `Drop-off from ${from.label} to ${worse.label} worsened ${pts(worse.drop_change_pts)} (conversion ${pct1(worse.conv_prev)} → ${pct1(worse.conv)})`,
      evidence: [
        `${n0(from.value ?? 0)} ${from.label.toLowerCase()} → ${n0(worse.value ?? 0)} ${worse.label.toLowerCase()} (${w}); comparison window ${funnel.cmpWindow ? `${formatDateShort(funnel.cmpWindow.from)} – ${formatDateShort(funnel.cmpWindow.to)}` : "—"}.`,
        `${from.source} → ${worse.source} counts. Both windows cover AppsFlyer days only, so rates are comparable even when the windows differ in length.`,
        ...(fresh && fresh.value !== null ? [`Fresh ATC users who went on to order in the window: ${n0(fresh.value)}; all Fresh orders by Meta-attributed users: ${n0(funnel.metaUserOrders ?? 0)}.`] : []),
      ],
      causes:
        worse.key === "fresh_atc"
          ? [{ text: "New installs reach the cart less often: lower-intent installs from cheaper or broader ad sets, or search / availability problems.", status: "hypothesis", confidence: "medium" }]
          : worse.key === "fresh_buyers"
            ? [{ text: "Cart → order loss for new users: cart-page friction (delivery fee, prescription upload, price), payment failures or slow abandoned-cart follow-up.", status: "hypothesis", confidence: "medium" }]
            : [{ text: "Post-click change (store page, deep link) or creative pull.", status: "hypothesis", confidence: "low" }],
      levers: worse.key === "fresh_atc" ? ["Creative / audience intent", "Search and availability"] : worse.key === "fresh_buyers" ? ["Cart page and payment", "Abandoned-cart follow-up"] : ["Store page and deep link"],
      action:
        worse.key === "fresh_atc"
          ? "Compare install → add-to-cart on the App Funnel page for the same days and pause the ad sets whose CPI fell while add-to-cart did not follow."
          : worse.key === "fresh_buyers"
            ? "Check that Fresh abandoned-cart leads are called within 30 minutes (Cart Recovery page) and break checkout → order down by payment method on the App Funnel page."
            : "Test the store listing and the ad → store deep link on a few devices.",
      impact: lostAtNext !== null && lostAtNext > 0 ? `At the comparison-period rate, about ${n0(lostAtNext)} more users would have reached ${worse.label.toLowerCase()} in this window.` : "—",
      followUp: `${from.label} → ${worse.label} conversion, weekly.`,
      weight: 9e6 + (lostAtNext ?? 0),
    });
  }

  // 2. Spend vs New Sales / Fresh-customer CAC.
  if (x.metaComparable && cmp && cur.freshCustomers && cmp.freshCustomers) {
    const cac = cur.meta.spend / cur.freshCustomers;
    const cacPrev = cmp.meta.spend / cmp.freshCustomers;
    const dCac = cac / cacPrev - 1;
    const dSpend = chg(cur.meta.spend, cmp.meta.spend);
    const dSales = chg(cur.newSales, cmp.newSales);
    if (Math.abs(dCac) >= 0.1) {
      const top = x.drivers.filter((d) => d.cac_change !== null && (d.af_first_purchasers ?? 0) >= 5).sort((a, b) => (dCac > 0 ? (b.cac_change ?? 0) - (a.cac_change ?? 0) : (a.cac_change ?? 0) - (b.cac_change ?? 0)))[0];
      out.push({
        id: "fresh-cac",
        kind: "performance",
        priority: dCac > 0 ? 1 : 3,
        affects: "Meta CAC per Fresh customer",
        title: `Meta CAC per Fresh customer ${dCac > 0 ? "rose" : "fell"} ${pctS(dCac)} (${inr(cacPrev)} → ${inr(cac)}) in ${x.periodLabel}`,
        evidence: [
          `Meta spend ${inr(cmp.meta.spend)} → ${inr(cur.meta.spend)}${dSpend !== null ? ` (${pctS(dSpend)})` : ""}; distinct Fresh customers ${n0(cmp.freshCustomers)} → ${n0(cur.freshCustomers)}.`,
          `New Sales (eligible Fresh orders, APP + WEB) ${n0(cmp.newSales ?? 0)} → ${n0(cur.newSales ?? 0)}${dSales !== null ? ` (${pctS(dSales)})` : ""}.`,
          "Blended: all Meta spend ÷ all Fresh customers, so WEB and organic customers are in the denominator too.",
          ...(top ? [`Campaign moving most (AppsFlyer first purchasers): ${top.short}, cost per first purchaser ${top.cost_per_af_fp_prev !== null ? inr(top.cost_per_af_fp_prev) : "—"} → ${top.cost_per_af_fp !== null ? inr(top.cost_per_af_fp) : "—"}.`] : []),
        ],
        causes: [
          dSpend !== null && dSales !== null && dSpend > dSales
            ? { text: "Spend grew faster than Fresh customers: extra budget bought fewer new customers (diminishing returns or weaker ad sets).", status: "confirmed", confidence: "medium" }
            : { text: "Fresh customers moved more than spend: demand outside Meta (WEB / organic) changed.", status: "hypothesis", confidence: "medium" },
        ],
        levers: ["Budget allocation between campaigns", "Creative mix"],
        action: top ? `Start with ${top.short}: compare its ad sets in the Campaigns table and move budget to the campaign with the lowest cost per first purchaser.` : "Use the campaign driver table to find which campaigns took the extra spend.",
        impact: `Each ₹100 of CAC at ${n0(cur.freshCustomers)} Fresh customers is about ${inr(cur.freshCustomers * 100)} of spend.`,
        followUp: "Meta CAC per Fresh customer and New Sales, weekly.",
        weight: 8e6,
      });
    }
  }

  // 3. Cost per Fresh ATC.
  if (x.afComparable && cur.af && cmp?.af && cur.af.atc_fresh >= 20 && cmp.af.atc_fresh >= 20) {
    const c = (cur.afSpend ?? 0) / cur.af.atc_fresh;
    const p = (cmp.afSpend ?? 0) / cmp.af.atc_fresh;
    const d = c / p - 1;
    if (Math.abs(d) >= 0.15) {
      out.push({
        id: "fresh-cost-per-atc",
        kind: "performance",
        priority: d > 0 ? 2 : 3,
        affects: "Cost per Fresh Add to Cart",
        title: `Cost per Fresh Add to Cart ${d > 0 ? "up" : "down"} ${pctS(d)} (${inr(p)} → ${inr(c)})`,
        evidence: [`Fresh Add to Carts (AppsFlyer, Meta users) ${n0(cmp.af.atc_fresh)} → ${n0(cur.af.atc_fresh)}; spend over the same days ${inr(cmp.afSpend ?? 0)} → ${inr(cur.afSpend ?? 0)}.`],
        causes: [{ text: d > 0 ? "Installs are getting cheaper or flat while fewer new users add to cart." : "More new users reach the cart per rupee.", status: "hypothesis", confidence: "medium" }],
        levers: ["Creative intent", "Audience"],
        action: d > 0 ? "Check the creative map for underperformers still spending and rotate in emerging creatives." : "Keep the current mix; confirm New Sales by Meta users follows.",
        impact: `At ${n0(cur.af.atc_fresh)} Fresh Add to Carts, every ₹10 of cost per Fresh ATC is ${inr(cur.af.atc_fresh * 10)} of spend.`,
        followUp: "Cost per Fresh ATC, weekly.",
        weight: 6e6,
      });
    }
  }

  // 4. How much of New Sales is placed by Meta-attributed users.
  if (funnel.metaShareOfNewSales !== null && cur.af && cur.newSales) {
    out.push({
      id: "fresh-meta-share",
      kind: "performance",
      priority: 3,
      affects: "New Sales placed by Meta-attributed users",
      title: `${pct1(funnel.metaShareOfNewSales)} of New Sales were placed by Meta-attributed app users (${n0(cur.af.fresh_orders)} of ${n0(cur.newSales)})`,
      evidence: [
        `${n0(cur.af.fresh_orders_app)} of them on APP, ${n0(cur.af.fresh_orders - cur.af.fresh_orders_app)} on WEB (sales-assisted) — ${n0(cur.af.fresh_customers)} distinct customers (${w}).`,
        "Matched by AppsFlyer customer ID to actual eligible Fresh orders. AppsFlyer sees paid users only; Meta itself has no purchase tracking.",
      ],
      causes: [{ text: "The remainder is WEB, organic or other paid demand, plus Meta users AppsFlyer could not identify.", status: "confirmed", confidence: "medium" }],
      levers: ["Attribution coverage (customer_user_id on events)"],
      action: "Use cost per Meta-user Fresh order (efficiency panel) as the Meta-specific cost of a new sale; use Meta CAC per Fresh customer as the blended view.",
      impact: "Separates what Meta-acquired users buy from total demand.",
      followUp: "Share of New Sales by Meta-attributed users, weekly.",
      weight: 2e6,
    });
  }

  // 5. Format with the lowest cost per AppsFlyer purchaser.
  const judged = x.formats.filter((f) => f.cost_per_af_purchaser !== null && (f.af_purchasers ?? 0) >= 10 && (f.spend_share ?? 0) >= 0.05);
  if (judged.length >= 2) {
    const best = [...judged].sort((a, b) => a.cost_per_af_purchaser! - b.cost_per_af_purchaser!)[0];
    const worst = [...judged].sort((a, b) => b.cost_per_af_purchaser! - a.cost_per_af_purchaser!)[0];
    if (worst.cost_per_af_purchaser! / best.cost_per_af_purchaser! >= 1.3) {
      out.push({
        id: "fresh-format",
        kind: "performance",
        priority: 2,
        affects: "Creative format mix",
        title: `${best.format} buys AppsFlyer purchasers at ${inr(best.cost_per_af_purchaser!)} vs ${inr(worst.cost_per_af_purchaser!)} for ${worst.format}`,
        evidence: judged.map((f) => `${f.format}: ${pct1(f.spend_share ?? 0)} of spend, CPI ${f.cpi !== null ? inr(f.cpi) : "—"}, ${n0(f.af_purchasers ?? 0)} AppsFlyer purchasers.`),
        causes: [{ text: "Format is read from ad names (UGC) and the October list / video views; AppsFlyer purchasers by ad name are all purchasers, not Fresh only.", status: "confirmed", confidence: "medium" }],
        levers: ["Format mix in creative briefs"],
        action: `Brief the next batch towards ${best.format} and give it a fair test budget; keep ${worst.format} only where its CPI is below the account.`,
        impact: "Shifting spend to the cheaper format lowers cost per purchaser at the same budget.",
        followUp: "Cost per AppsFlyer purchaser by format, weekly.",
        weight: 3e6,
      });
    }
  }
  return out;
}

/** Short label for a window. */
export const spanLabel = (from: string, to: string) => (from === to ? formatDateShort(from) : `${formatDateShort(from)} – ${formatDateShort(to)}`);
