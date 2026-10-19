// Pure view-model for the Regional Analysis page: derives AOV, shares, RTO and cancellation rates, period-over-period
// change, the metro ranking, daily series, period comparison and rule-based insights from validated RegionalRow
// aggregates. No I/O.
//
// AOV is always revenue ÷ orders of the same row — never an average of daily or child AOVs. Rates are always ratios of
// the same row's counts: RTO rate = RTO ÷ (delivered + RTO); cancellation rate = cancelled ÷ placed.

import { TIER_LABEL, TIER_ORDER, WATCH_AREAS, type RegionTier } from "../geo/regions.ts";
import type { PeriodSpec } from "../format/periods.ts";
import type { RegionalRow } from "../types/schemas";

export interface RegionalMetrics {
  key: string;
  group: string;
  fresh_orders: number;
  fresh_app: number;
  fresh_web: number;
  customers: number;
  revenue: number;
  aov: number | null;
  web_share: number | null;
  order_share: number | null;
  placed_orders: number;
  cancelled_orders: number;
  cancel_rate: number | null;
  delivered_orders: number;
  rto_orders: number;
  rto_rate: number | null;
  orders_prev: number | null;
  orders_change: number | null;
  group_size: number | null;
}

export interface Insight {
  kind: "watch" | "aov_high" | "aov_low" | "growth" | "decline" | "web_mix" | "rto_high" | "cancel_high" | "concentration";
  text: string;
}

export interface RegionalView {
  total: RegionalMetrics | null;
  markets: RegionalMetrics[];
  tiers: RegionalMetrics[];
  areas: RegionalMetrics[];
  topMetros: RegionalMetrics[];
  pincodes: RegionalMetrics[];
  daily: Record<string, string | number | null>[];
  /** Orders whose location cannot be verified (count only — never listed). */
  unverifiedOrders: number;
  /** Watch markets (e.g. Surat, Visakhapatnam) that received orders this period. */
  watch: (RegionalMetrics & { note: string })[];
  insights: Insight[];
}

/** Rows with fewer orders than this are not used for outlier insights (too noisy). */
export const INSIGHT_MIN_ORDERS = 20;
const AOV_DEVIATION = 0.3;
const ORDER_CHANGE = 0.3;
const WEB_SHARE_DEVIATION = 0.15;
/** RTO / cancellation rate this many points above the overall rate is flagged. */
const RATE_DEVIATION = 0.1;

const div = (n: number, d: number) => (d === 0 ? null : n / d);

export function toMetrics(r: RegionalRow, totalOrders: number, prev?: RegionalRow): RegionalMetrics {
  const ordersPrev = prev ? prev.fresh_orders : null;
  return {
    key: r.key,
    group: r.group,
    fresh_orders: r.fresh_orders,
    fresh_app: r.fresh_app,
    fresh_web: r.fresh_web,
    customers: r.customers,
    revenue: r.revenue,
    aov: div(r.revenue, r.fresh_orders),
    web_share: div(r.fresh_web, r.fresh_orders),
    order_share: div(r.fresh_orders, totalOrders),
    placed_orders: r.placed_orders,
    cancelled_orders: r.cancelled_orders,
    cancel_rate: div(r.cancelled_orders, r.placed_orders),
    delivered_orders: r.delivered_orders,
    rto_orders: r.rto_orders,
    rto_rate: div(r.rto_orders, r.delivered_orders + r.rto_orders),
    orders_prev: ordersPrev,
    orders_change: ordersPrev === null ? null : div(r.fresh_orders - ordersPrev, ordersPrev),
    group_size: r.group_size,
  };
}

const levelKey = (r: RegionalRow) => `${r.level}|${r.group}|${r.key}`;
const ZERO = { fresh_orders: 0, fresh_app: 0, fresh_web: 0, customers: 0, revenue: 0, placed_orders: 0, cancelled_orders: 0, delivered_orders: 0, rto_orders: 0 };

export function buildRegionalView(
  rows: readonly RegionalRow[],
  prevRows: readonly RegionalRow[] | null,
  dates: readonly string[],
): RegionalView {
  const prev = new Map((prevRows ?? []).map((r) => [levelKey(r), r]));
  // A missing previous-period row means zero orders then, but only if the previous period loaded at all.
  const prevOf = (r: RegionalRow): RegionalRow | undefined => prev.get(levelKey(r)) ?? (prevRows ? { ...r, ...ZERO } : undefined);

  const totalRow = rows.find((r) => r.level === "total");
  const totalOrders = totalRow?.fresh_orders ?? 0;
  const m = (r: RegionalRow) => toMetrics(r, totalOrders, prevOf(r));
  const of = (level: RegionalRow["level"]) => rows.filter((r) => r.level === level);
  const byOrders = (a: RegionalMetrics, b: RegionalMetrics) => b.fresh_orders - a.fresh_orders || (a.key < b.key ? -1 : 1);
  const tierRank = (g: string) => TIER_ORDER.indexOf(g as RegionTier);

  const tiers = of("tier").map(m).sort((a, b) => tierRank(a.group) - tierRank(b.group));
  const areas = of("area")
    .map(m)
    .sort((a, b) => tierRank(a.group) - tierRank(b.group) || byOrders(a, b));
  const topMetros = of("metro_city").map(m).sort(byOrders).slice(0, 10);
  const pincodes = of("pincode")
    .map(m)
    .sort((a, b) => (a.group_size ?? 1) - (b.group_size ?? 1) || byOrders(a, b));
  const marketOrder = ["mumbai", "other_metros", "tier_2", "smaller_markets", "unverified"];
  const markets = of("market")
    .map(m)
    .sort((a, b) => marketOrder.indexOf(a.group) - marketOrder.indexOf(b.group));

  const dailyByKey = new Map(of("daily_tier").map((r) => [`${r.key}|${r.group}`, r.fresh_orders]));
  const daily = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const t of TIER_ORDER) row[t] = dailyByKey.get(`${date}|${t}`) ?? 0;
    return row;
  });

  const total = totalRow ? m(totalRow) : null;
  const watch = areas.filter((a) => WATCH_AREAS[a.key] && a.placed_orders > 0).map((a) => ({ ...a, note: WATCH_AREAS[a.key] }));
  return {
    total,
    markets,
    tiers,
    areas,
    topMetros,
    pincodes,
    daily,
    unverifiedOrders: tiers.find((t) => t.group === "unverified")?.fresh_orders ?? 0,
    watch,
    insights: total ? buildInsights(total, tiers, areas) : [],
  };
}

// ---------- Period comparison (end date / previous day / last 7 days / month to date) ----------

export interface PeriodView {
  /** One row per period: overall metrics plus the number of complete days and per-day averages (null when 0 days). */
  overall: (RegionalMetrics & { period: string; label: string; days: number | null; orders_per_day: number | null; revenue_per_day: number | null })[];
  /** One row per tier, with Fresh orders per period (keys = period ids). */
  tierOrders: Record<string, string | number | null>[];
  /** Average Fresh orders per complete day by tier, one row per period with at least one complete day. */
  perDayByTier: Record<string, string | number | null>[];
}

export function buildPeriodView(rows: readonly RegionalRow[], specs: readonly PeriodSpec[]): PeriodView {
  const totals = new Map(rows.filter((r) => r.level === "total").map((r) => [r.period ?? "", r]));
  const overall = specs
    .filter((p) => totals.has(p.id))
    .map((p) => {
      const r = totals.get(p.id)!;
      return {
        ...toMetrics(r, r.fresh_orders),
        period: p.id,
        label: p.label,
        days: p.partial ? null : p.days,
        orders_per_day: p.days ? r.fresh_orders / p.days : null,
        revenue_per_day: p.days ? r.revenue / p.days : null,
      };
    });
  const tierRow = (period: string, tier: string) => rows.find((r) => r.level === "tier" && r.period === period && r.group === tier);
  const tierOrders = TIER_ORDER.filter((t) => rows.some((r) => r.level === "tier" && r.group === t)).map((t) => {
    const row: Record<string, string | number | null> = { tier: TIER_LABEL[t] };
    for (const p of specs) row[p.id] = tierRow(p.id, t)?.fresh_orders ?? 0;
    return row;
  });
  const perDayByTier = specs
    .filter((p) => p.days > 0 && totals.has(p.id))
    .map((p) => {
      const row: Record<string, string | number | null> = { period: p.label };
      for (const t of TIER_ORDER) row[t] = Math.round(((tierRow(p.id, t)?.fresh_orders ?? 0) / p.days) * 10) / 10;
      return row;
    });
  return { overall, tierOrders, perDayByTier };
}

// ---------- Insights ----------

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;

/** Rule-based, explainable insights. Every outlier rule needs at least INSIGHT_MIN_ORDERS orders in the area. */
export function buildInsights(total: RegionalMetrics, tiers: readonly RegionalMetrics[], areas: readonly RegionalMetrics[]): Insight[] {
  const out: (Insight & { weight: number })[] = [];
  const where = (a: RegionalMetrics) => `${a.key} (${TIER_LABEL[a.group as RegionTier] ?? a.group})`;

  const priority = tiers.find((t) => t.group === "priority_mumbai");
  if (priority?.order_share !== null && priority?.order_share !== undefined) {
    out.push({
      kind: "concentration",
      weight: Number.MAX_SAFE_INTEGER,
      text: `Priority Mumbai pincodes delivered ${pct(priority.order_share)} of eligible Fresh orders (${priority.fresh_orders.toLocaleString("en-IN")}).`,
    });
  }

  // Watch markets are always flagged when they get orders, whatever the volume.
  for (const a of areas) {
    const note = WATCH_AREAS[a.key];
    if (!note || a.placed_orders === 0) continue;
    out.push({
      kind: "watch",
      weight: Number.MAX_SAFE_INTEGER - 1,
      text: `${a.key}: ${a.fresh_orders} Fresh order${a.fresh_orders === 1 ? "" : "s"} this period (${note.toLowerCase()})${
        a.rto_rate !== null ? `, RTO rate ${pct(a.rto_rate)}` : ""
      }.`,
    });
  }

  for (const a of areas) {
    const resolved = a.delivered_orders + a.rto_orders;
    if (a.rto_rate !== null && total.rto_rate !== null && resolved >= INSIGHT_MIN_ORDERS && a.rto_rate - total.rto_rate >= RATE_DEVIATION) {
      out.push({
        kind: "rto_high",
        weight: a.rto_orders * 2,
        text: `${where(a)}: RTO rate ${pct(a.rto_rate)} vs ${pct(total.rto_rate)} overall (${a.rto_orders} of ${resolved} resolved shipments).`,
      });
    }
    if (a.cancel_rate !== null && total.cancel_rate !== null && a.placed_orders >= INSIGHT_MIN_ORDERS && a.cancel_rate - total.cancel_rate >= RATE_DEVIATION) {
      out.push({
        kind: "cancel_high",
        weight: a.cancelled_orders * 2,
        text: `${where(a)}: ${pct(a.cancel_rate)} of placed orders cancelled vs ${pct(total.cancel_rate)} overall.`,
      });
    }
    if (a.fresh_orders < INSIGHT_MIN_ORDERS) continue;
    if (a.aov !== null && total.aov) {
      const dev = (a.aov - total.aov) / total.aov;
      if (Math.abs(dev) >= AOV_DEVIATION) {
        out.push({
          kind: dev > 0 ? "aov_high" : "aov_low",
          weight: a.fresh_orders,
          text: `${where(a)}: AOV ${inr(a.aov)} is ${pct(dev)} ${dev > 0 ? "above" : "below"} the overall ${inr(total.aov)}.`,
        });
      }
    }
    if (a.orders_change !== null && a.orders_prev !== null && a.orders_prev >= INSIGHT_MIN_ORDERS && Math.abs(a.orders_change) >= ORDER_CHANGE) {
      out.push({
        kind: a.orders_change > 0 ? "growth" : "decline",
        weight: Math.abs(a.fresh_orders - a.orders_prev),
        text: `${where(a)}: Fresh orders ${a.orders_change > 0 ? "up" : "down"} ${pct(a.orders_change)} vs the previous period (${a.orders_prev} → ${a.fresh_orders}).`,
      });
    }
    if (a.web_share !== null && total.web_share !== null && Math.abs(a.web_share - total.web_share) >= WEB_SHARE_DEVIATION) {
      out.push({
        kind: "web_mix",
        weight: a.fresh_orders,
        text: `${where(a)}: ${pct(a.web_share)} of Fresh orders are sales-assisted WEB, vs ${pct(total.web_share)} overall.`,
      });
    }
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map(({ kind, text }) => ({ kind, text }));
}
