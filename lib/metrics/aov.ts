// New Sales AOV intelligence. Pure (no I/O). Input = eligible Fresh orders aggregated by IST date × channel × payment
// mode × region × AOV bracket (lib/sql/aov_fresh.sql). Every order sits in exactly one row, so any slice adds up.
//
// AOV = eligible Fresh revenue ÷ eligible Fresh orders, always from the same slice's sums — never an average of AOVs.
// Changes in AOV are split exactly into a MIX effect (order share moving between groups) and a RATE effect (AOV moving
// within groups): ΔAOV = Σ (s₁ − s₀)·a₀ + Σ s₁·(a₁ − a₀).

import { TIER_LABEL, type RegionTier } from "../geo/regions.ts";
import type { ActionInsight } from "./actionInsights.ts";
import type { AovFreshRow } from "../types/schemas";

export type Bracket = "b0_100" | "b100_200" | "b200_500" | "b500_600" | "b600_plus" | "no_amount";

export const BRACKETS: readonly Bracket[] = ["b0_100", "b100_200", "b200_500", "b500_600", "b600_plus", "no_amount"];

export const BRACKET_LABEL: Record<Bracket, string> = {
  b0_100: "₹0–100",
  b100_200: "₹100–200",
  b200_500: "₹200–500",
  b500_600: "₹500–600",
  b600_plus: "₹600+",
  no_amount: "Amount missing",
};

/** Lower bound inclusive, upper exclusive: ₹100.00 is in ₹100–200, ₹599.99 in ₹500–600, ₹600 in ₹600+. */
export function bracketOf(amount: number | null): Bracket {
  if (amount === null || !Number.isFinite(amount)) return "no_amount";
  if (amount < 100) return "b0_100";
  if (amount < 200) return "b100_200";
  if (amount < 500) return "b200_500";
  if (amount < 600) return "b500_600";
  return "b600_plus";
}

const div = (n: number, d: number) => (d === 0 ? null : n / d);
const inWin = (r: AovFreshRow, from: string, to: string) => r.order_date >= from && r.order_date <= to;

export interface Agg {
  orders: number;
  revenue: number;
  aov: number | null;
}

function agg(rows: readonly AovFreshRow[]): Agg {
  let orders = 0;
  let revenue = 0;
  for (const r of rows) {
    orders += r.orders;
    revenue += r.revenue;
  }
  return { orders, revenue, aov: div(revenue, orders) };
}

export function windowAgg(rows: readonly AovFreshRow[], from: string, to: string): Agg {
  return agg(rows.filter((r) => inWin(r, from, to)));
}

// ---------- Bracket mix ----------

export interface BracketRow {
  bracket: Bracket;
  label: string;
  orders: number;
  order_share: number | null;
  revenue: number;
  revenue_share: number | null;
  aov: number | null;
  orders_prev: number | null;
  order_share_prev: number | null;
  /** Change in order share, percentage points (as a fraction). */
  share_change: number | null;
}

export function bracketMix(rows: readonly AovFreshRow[], cur: { from: string; to: string }, prev: { from: string; to: string } | null): BracketRow[] {
  const c = rows.filter((r) => inWin(r, cur.from, cur.to));
  const p = prev ? rows.filter((r) => inWin(r, prev.from, prev.to)) : null;
  const tc = agg(c);
  const tp = p ? agg(p) : null;
  return BRACKETS.map((b) => {
    const a = agg(c.filter((r) => r.bracket === b));
    const ap = p ? agg(p.filter((r) => r.bracket === b)) : null;
    const share = div(a.orders, tc.orders);
    const shareP = ap && tp ? div(ap.orders, tp.orders) : null;
    return {
      bracket: b,
      label: BRACKET_LABEL[b],
      orders: a.orders,
      order_share: share,
      revenue: a.revenue,
      revenue_share: div(a.revenue, tc.revenue),
      aov: a.aov,
      orders_prev: ap ? ap.orders : null,
      order_share_prev: shareP,
      share_change: share !== null && shareP !== null ? share - shareP : null,
    };
  }).filter((r) => r.bracket !== "no_amount" || r.orders > 0 || (r.orders_prev ?? 0) > 0);
}

// ---------- Daily series ----------

export type DailyAovPoint = { date: string; orders: number; revenue: number; aov: number | null; aov_7d: number | null } & Record<Bracket, number> & Record<`${Bracket}_share`, number | null>;

export function dailyAov(rows: readonly AovFreshRow[], dates: readonly string[]): DailyAovPoint[] {
  const byDate = new Map<string, AovFreshRow[]>();
  for (const r of rows) byDate.set(r.order_date, [...(byDate.get(r.order_date) ?? []), r]);
  const pts = dates.map((date) => {
    const rs = byDate.get(date) ?? [];
    const t = agg(rs);
    const point: Record<string, number | string | null> = { date, orders: t.orders, revenue: Math.round(t.revenue), aov: t.aov === null ? null : Math.round(t.aov) };
    for (const b of BRACKETS) {
      const n = rs.filter((r) => r.bracket === b).reduce((s, r) => s + r.orders, 0);
      point[b] = n;
      point[`${b}_share`] = t.orders ? n / t.orders : null;
    }
    return point;
  });
  // Trailing 7-day AOV from summed revenue ÷ summed orders (not an average of daily AOVs).
  return pts.map((p, i) => {
    const w = pts.slice(Math.max(0, i - 6), i + 1);
    const o = w.reduce((s, x) => s + Number(x.orders), 0);
    const r = w.reduce((s, x) => s + Number(x.revenue), 0);
    return { ...p, aov_7d: i >= 6 && o ? Math.round(r / o) : null } as DailyAovPoint;
  });
}

// ---------- Breakdowns with mix / rate decomposition ----------

export type Dimension = "channel" | "payment_mode" | "region";

export const DIMENSION_LABEL: Record<Dimension, string> = { channel: "Order platform", payment_mode: "Payment mode", region: "Region" };

const REGION_ORDER: readonly string[] = ["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3", "unverified"];

export function groupLabel(dim: Dimension, key: string): string {
  if (dim === "region") return TIER_LABEL[key as RegionTier] ?? key;
  if (dim === "channel") return key === "APP" ? "APP (self-serve)" : "WEB (sales-assisted)";
  return key;
}

export interface BreakdownRow {
  key: string;
  label: string;
  orders: number;
  share: number | null;
  revenue: number;
  aov: number | null;
  orders_prev: number | null;
  share_prev: number | null;
  aov_prev: number | null;
  aov_change: number | null;
  share_change: number | null;
  /** Contribution to the total AOV change (₹): mix = Δshare × (group AOV − overall AOV), previous period; rate = share × ΔAOV. */
  mix_effect: number | null;
  rate_effect: number | null;
  /** Share of this group's orders at ₹600+ / below ₹200. */
  high_share: number | null;
  low_share: number | null;
}

export interface Breakdown {
  dim: Dimension;
  rows: BreakdownRow[];
  total: Agg;
  totalPrev: Agg | null;
  /** Σ mix effects and Σ rate effects; they add up to the total AOV change. */
  mix: number | null;
  rate: number | null;
}

export function breakdown(rows: readonly AovFreshRow[], dim: Dimension, cur: { from: string; to: string }, prev: { from: string; to: string } | null): Breakdown {
  const keyOf = (r: AovFreshRow) => (dim === "channel" ? r.channel : dim === "payment_mode" ? r.payment_mode : r.region);
  const c = rows.filter((r) => inWin(r, cur.from, cur.to));
  const p = prev ? rows.filter((r) => inWin(r, prev.from, prev.to)) : null;
  const tc = agg(c);
  const tp = p ? agg(p) : null;
  const keys = [...new Set([...c, ...(p ?? [])].map(keyOf))].sort((a, b) =>
    dim === "region" ? REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b) : dim === "channel" ? (a < b ? -1 : 1) : 0,
  );
  const out = keys.map((k) => {
    const g = c.filter((r) => keyOf(r) === k);
    const a = agg(g);
    const ap = p ? agg(p.filter((r) => keyOf(r) === k)) : null;
    const s1 = div(a.orders, tc.orders) ?? 0;
    const s0 = ap && tp ? (div(ap.orders, tp.orders) ?? 0) : null;
    // Groups with no orders in one period contribute via mix only (their AOV there is undefined).
    const a0 = ap?.aov ?? null;
    const a1 = a.aov;
    // Measured against the previous overall AOV, so a group whose AOV is close to average has ~0 mix effect even when
    // its share moves a lot. Σ(s₁ − s₀) = 0, so the total is unchanged.
    const base = tp?.aov ?? 0;
    const mix = s0 !== null ? (s1 - s0) * ((a0 ?? a1 ?? base) - base) : null;
    const rate = s0 !== null && a0 !== null && a1 !== null ? s1 * (a1 - a0) : s0 !== null ? 0 : null;
    return {
      key: k,
      label: groupLabel(dim, k),
      orders: a.orders,
      share: div(a.orders, tc.orders),
      revenue: a.revenue,
      aov: a1,
      orders_prev: ap ? ap.orders : null,
      share_prev: s0,
      aov_prev: a0,
      aov_change: a1 !== null && a0 ? a1 / a0 - 1 : null,
      share_change: s0 !== null ? s1 - s0 : null,
      mix_effect: mix,
      rate_effect: rate,
      high_share: div(g.filter((r) => r.bracket === "b600_plus").reduce((s, r) => s + r.orders, 0), a.orders),
      low_share: div(g.filter((r) => r.bracket === "b0_100" || r.bracket === "b100_200").reduce((s, r) => s + r.orders, 0), a.orders),
    };
  });
  const sum = (f: (r: BreakdownRow) => number | null) => (out.some((r) => f(r) === null) ? null : out.reduce((s, r) => s + (f(r) ?? 0), 0));
  return { dim, rows: out.sort((x, y) => (dim === "payment_mode" ? y.orders - x.orders : 0)), total: tc, totalPrev: tp, mix: p ? sum((r) => r.mix_effect) : null, rate: p ? sum((r) => r.rate_effect) : null };
}

/** Platform × payment mode cells (APP CASH, WEB ONLINE, …) — where platform and payment differences combine. */
export function platformPayment(rows: readonly AovFreshRow[], cur: { from: string; to: string }, prev: { from: string; to: string } | null): Breakdown {
  const re = rows.map((r) => ({ ...r, payment_mode: `${r.channel} · ${r.payment_mode}` }));
  return breakdown(re, "payment_mode", cur, prev);
}

// ---------- Insights ----------

const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const sinr = (x: number) => `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const spct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");

/** Fewer orders than this in a group (either period) and the group is not used to explain AOV. */
const MIN_ORDERS = 20;

export interface AovInsightInput {
  label: string;
  cmpLabel: string;
  cur: Agg;
  prev: Agg | null;
  brackets: BracketRow[];
  byDim: Breakdown[];
  platformPay: Breakdown;
}

export function aovInsights(x: AovInsightInput): ActionInsight[] {
  const out: ActionInsight[] = [];
  const { cur, prev } = x;
  if (!prev || cur.aov === null || prev.aov === null || cur.orders < MIN_ORDERS || prev.orders < MIN_ORDERS) return out;
  const dAov = cur.aov - prev.aov;
  const dOrders = div(cur.orders - prev.orders, prev.orders);

  // 1. Headline: what moved AOV, split by dimension into mix vs rate.
  const explained = x.byDim
    .filter((b) => b.mix !== null && b.rate !== null)
    .map((b) => ({ b, top: [...b.rows].filter((r) => r.orders >= MIN_ORDERS || (r.orders_prev ?? 0) >= MIN_ORDERS).sort((p, q) => Math.abs((q.mix_effect ?? 0) + (q.rate_effect ?? 0)) - Math.abs((p.mix_effect ?? 0) + (p.rate_effect ?? 0)))[0] }));
  const strongestMix = [...explained].sort((p, q) => Math.abs(q.b.mix ?? 0) - Math.abs(p.b.mix ?? 0))[0];
  if (Math.abs(dAov) >= 15 || Math.abs(dAov / prev.aov) >= 0.05) {
    out.push({
      id: "aov-headline",
      kind: "performance",
      priority: dAov < 0 ? 1 : 3,
      affects: "AOV (eligible Fresh revenue ÷ eligible Fresh orders)",
      title: `AOV ${dAov >= 0 ? "rose" : "fell"} ${sinr(dAov)} (${inr(prev.aov)} → ${inr(cur.aov)}, ${spct(dAov / prev.aov)}) while Fresh orders ${dOrders !== null ? `moved ${spct(dOrders)}` : "changed"}`,
      evidence: [
        `${x.label}: ${n0(cur.orders)} eligible Fresh orders, ${inr(cur.revenue)} revenue. ${x.cmpLabel}: ${n0(prev.orders)} orders, ${inr(prev.revenue)}.`,
        ...explained.map(
          ({ b }) => `${DIMENSION_LABEL[b.dim]}: order-mix shift ${sinr(b.mix ?? 0)}, within-group AOV change ${sinr(b.rate ?? 0)} (together ${sinr((b.mix ?? 0) + (b.rate ?? 0))}).`,
        ),
        ...(() => {
          // The single largest effect across all dimensions (mix or basket), from groups with enough orders.
          const cand = explained.flatMap(({ b }) =>
            b.rows
              .filter((r) => r.orders >= MIN_ORDERS && (r.orders_prev ?? 0) >= MIN_ORDERS)
              .flatMap((r) => [
                { what: `${r.label} basket size (AOV ${inr(r.aov_prev ?? 0)} → ${inr(r.aov ?? 0)})`, v: r.rate_effect ?? 0 },
                { what: `${r.label} order share (${pct(r.share_prev ?? 0)} → ${pct(r.share ?? 0)})`, v: r.mix_effect ?? 0 },
              ]),
          );
          const top = cand.sort((p, q) => Math.abs(q.v) - Math.abs(p.v))[0];
          return top ? [`Largest single contributor: ${top.what}, ${sinr(top.v)} of AOV.`] : [];
        })(),
      ],
      causes: [
        strongestMix && Math.abs(strongestMix.b.mix ?? 0) >= Math.abs(dAov) * 0.4
          ? { text: `Order mix by ${DIMENSION_LABEL[strongestMix.b.dim].toLowerCase()} explains ${sinr(strongestMix.b.mix ?? 0)} of the ${sinr(dAov)} — a shift in WHO orders, not in basket size.`, status: "confirmed", confidence: "high" }
          : { text: "Most of the change is within groups (basket sizes moved), not a shift in order mix.", status: "confirmed", confidence: "high" },
      ],
      levers: ["Order mix (platform, payment, region)", "Basket size within each group"],
      action: "Use the breakdown tables below: act first on the group with the largest combined effect.",
      impact: `At ${n0(cur.orders)} Fresh orders, each ₹10 of AOV is ${inr(cur.orders * 10)} of New Sales revenue over ${x.label.toLowerCase()}.`,
      followUp: "AOV and Fresh orders together, daily (trend chart) — AOV gains only count if order volume holds.",
      weight: 1e9,
    });
  }

  // 2. Bracket mix shift.
  const moved = [...x.brackets].filter((b) => b.share_change !== null && b.bracket !== "no_amount").sort((p, q) => Math.abs(q.share_change ?? 0) - Math.abs(p.share_change ?? 0));
  const up = moved.find((b) => (b.share_change ?? 0) > 0);
  const down = moved.find((b) => (b.share_change ?? 0) < 0);
  if (up && down && Math.abs(up.share_change ?? 0) >= 0.03) {
    const high = x.brackets.find((b) => b.bracket === "b600_plus");
    const low = x.brackets.filter((b) => b.bracket === "b0_100" || b.bracket === "b100_200");
    const lowShare = low.reduce((s, b) => s + (b.order_share ?? 0), 0);
    const lowRev = low.reduce((s, b) => s + (b.revenue_share ?? 0), 0);
    out.push({
      id: "aov-bracket-shift",
      kind: "performance",
      priority: up.bracket === "b0_100" || up.bracket === "b100_200" ? 1 : 3,
      affects: "AOV bracket mix",
      title: `Order mix moved towards ${up.label} (${pts(up.share_change!)}) and away from ${down.label} (${pts(down.share_change!)})`,
      evidence: [
        ...moved.slice(0, 4).map((b) => `${b.label}: ${pct(b.order_share_prev ?? 0)} → ${pct(b.order_share ?? 0)} of orders (${n0(b.orders_prev ?? 0)} → ${n0(b.orders)}); ${pct(b.revenue_share ?? 0)} of revenue now.`),
        `Orders under ₹200 are ${pct(lowShare)} of orders but ${pct(lowRev)} of revenue${high ? `; ₹600+ is ${pct(high.order_share ?? 0)} of orders and ${pct(high.revenue_share ?? 0)} of revenue` : ""}.`,
      ],
      causes: [{ text: "Small first orders (single-strip / trial purchases) or a change in which customers are being acquired; see platform and region below for which group moved.", status: "hypothesis", confidence: "medium" }],
      levers: ["Minimum-order / free-delivery threshold", "Bundles and refill-quantity prompts at checkout"],
      action:
        up.bracket === "b0_100" || up.bracket === "b100_200"
          ? "Test a cart nudge for baskets under ₹200 (e.g. 'add 1 month supply' or a free-delivery threshold just above ₹200) on APP first, and keep it only if Fresh orders per day hold."
          : "Keep the current mix; check that the higher-value growth is not from a one-off bulk order (bracket table, ₹600+ AOV).",
      impact: (() => {
        const lowOrders = low.reduce((s, b) => s + b.orders, 0);
        const lowAov = lowOrders ? low.reduce((s, b) => s + b.revenue, 0) / lowOrders : null;
        const midAov = x.brackets.find((b) => b.bracket === "b200_500")?.aov ?? null;
        return lowAov !== null && midAov !== null
          ? `Moving 5% of orders from under ₹200 (avg ${inr(lowAov)}) into ₹200–500 (avg ${inr(midAov)}) would add about ${inr(cur.orders * 0.05 * (midAov - lowAov))} over the period at the same order count.`
          : "—";
      })(),
      followUp: "Share of Fresh orders under ₹200 and Fresh orders per day, weekly.",
      weight: 8e8,
    });
  }

  // 3. Platform / payment differences (structural, not only change).
  const cells = x.platformPay.rows.filter((r) => r.orders >= MIN_ORDERS && r.aov !== null);
  if (cells.length >= 2) {
    const hi = [...cells].sort((p, q) => q.aov! - p.aov!)[0];
    const lo = [...cells].sort((p, q) => p.aov! - q.aov!)[0];
    if (hi.aov! / lo.aov! >= 1.3) {
      const movedCell = [...x.platformPay.rows].filter((r) => r.share_change !== null).sort((p, q) => Math.abs(q.share_change!) - Math.abs(p.share_change!))[0];
      out.push({
        id: "aov-platform-payment",
        kind: "performance",
        priority: 2,
        affects: "AOV by platform × payment mode",
        title: `${hi.key} orders average ${inr(hi.aov!)} vs ${inr(lo.aov!)} for ${lo.key} (${(hi.aov! / lo.aov!).toFixed(1)}×)`,
        evidence: [
          ...cells.map((r) => `${r.key}: ${n0(r.orders)} orders (${pct(r.share ?? 0)}), AOV ${inr(r.aov!)}${r.aov_prev ? ` (was ${inr(r.aov_prev)}${(r.orders_prev ?? 0) < 50 ? ", small sample — one large order moves it" : ""})` : ""}; ₹600+ ${pct(r.high_share ?? 0)}, under ₹200 ${pct(r.low_share ?? 0)}.`),
          ...(movedCell && Math.abs(movedCell.share_change!) >= 0.02 ? [`Biggest mix move: ${movedCell.key} ${pts(movedCell.share_change!)} of orders vs ${x.cmpLabel.toLowerCase()}.`] : []),
        ],
        causes: [
          { text: "WEB orders are sales-assisted: agents build larger, multi-item baskets.", status: "hypothesis", confidence: "medium" },
          { text: "Cash (COD) on APP skews to small trial orders from new customers who do not want to pay upfront.", status: "hypothesis", confidence: "low" },
        ],
        levers: ["Sales-assist for high-value carts", "Prepaid incentive on larger baskets"],
        action: `Route APP carts above ₹600 that stall at checkout to the sales team, and test a small prepaid incentive on APP baskets above ₹500; judge on ${lo.key} AOV and APP Fresh orders.`,
        impact: `Lifting ${lo.key} AOV by 10% (${inr(lo.aov! * 0.1)}) on ${n0(lo.orders)} orders adds about ${inr(lo.orders * lo.aov! * 0.1)} over the period.`,
        followUp: `${lo.key} AOV and order count, weekly.`,
        weight: 6e8,
      });
    }
  }

  // 4. Regional AOV and mix.
  const reg = x.byDim.find((b) => b.dim === "region");
  if (reg) {
    const pm = reg.rows.find((r) => r.key === "priority_mumbai");
    const t3 = reg.rows.find((r) => r.key === "tier_3");
    const shifts = reg.rows.filter((r) => r.share_change !== null && r.orders >= MIN_ORDERS).sort((p, q) => Math.abs(q.share_change!) - Math.abs(p.share_change!));
    if (pm && t3 && pm.aov !== null && t3.aov !== null && pm.orders >= MIN_ORDERS && t3.orders >= MIN_ORDERS) {
      const regMix = reg.mix ?? 0;
      const gap = Math.abs(pm.aov - t3.aov) / Math.max(pm.aov, t3.aov);
      out.push({
        id: "aov-region",
        kind: "performance",
        priority: Math.abs(regMix) >= 10 ? 2 : 3,
        affects: "AOV by region",
        title: `Priority Mumbai AOV ${inr(pm.aov)} vs Tier 3 ${inr(t3.aov)}; regional mix moved AOV ${sinr(regMix)}`,
        evidence: [
          ...reg.rows.filter((r) => r.orders >= MIN_ORDERS).map((r) => `${r.label}: ${n0(r.orders)} orders (${pct(r.share ?? 0)}${r.share_change !== null ? `, ${pts(r.share_change)}` : ""}), AOV ${inr(r.aov ?? 0)}${r.aov_prev ? ` (was ${inr(r.aov_prev)})` : ""}.`),
          ...(shifts[0] ? [`Largest share move: ${shifts[0].label} ${pts(shifts[0].share_change!)}.`] : []),
        ],
        causes: [
          { text: `Regional order mix changed AOV by ${sinr(regMix)}; AOV changes within regions by ${sinr(reg.rate ?? 0)}.`, status: "confirmed", confidence: "high" },
          ...(gap >= 0.05
            ? [{ text: "Acquisition spreading to smaller towns brings smaller first baskets (see Regional page: Tier 3 expansion).", status: "hypothesis" as const, confidence: "medium" as const }]
            : [{ text: `Tier 3 and Priority Mumbai baskets are about the same size, so the shift towards Tier 3 is not what moved AOV; ${(reg.rate ?? 0) < 0 ? "baskets shrank inside most regions" : "baskets grew inside most regions"}.`, status: "confirmed" as const, confidence: "high" as const }]),
        ],
        levers: ["Regional targeting", "Region-specific basket offers"],
        action:
          gap >= 0.05
            ? "Weight acquisition towards Priority Mumbai pincodes where baskets are larger; for Tier 3, test a refill-quantity prompt rather than discounts."
            : "Do not use AOV to judge regions — judge Tier 3 on RTO and cost per order (Regional page). Look for the AOV cause in platform and payment instead.",
        impact:
          gap >= 0.05
            ? `Each 5 points of order share moved from Tier 3 to Priority Mumbai changes AOV by about ${sinr(0.05 * (pm.aov - t3.aov))} at current regional AOVs.`
            : `Regional mix accounts for ${sinr(regMix)} of the AOV change; within-region baskets account for ${sinr(reg.rate ?? 0)}.`,
        followUp: "AOV and order share by region, weekly.",
        weight: 5e8,
      });
    }
  }

  // 5. Volume vs value trade-off.
  if (dOrders !== null && Math.sign(dAov) !== Math.sign(dOrders) && Math.abs(dOrders) >= 0.05) {
    const revChange = div(cur.revenue - prev.revenue, prev.revenue);
    out.push({
      id: "aov-volume-tradeoff",
      kind: "performance",
      priority: 2,
      affects: "New Sales revenue (orders × AOV)",
      title: `${dAov < 0 ? "Volume up, value down" : "Value up, volume down"}: orders ${spct(dOrders)}, AOV ${spct(dAov / prev.aov)}, revenue ${revChange !== null ? spct(revChange) : "—"}`,
      evidence: [`Revenue = orders × AOV: ${n0(prev.orders)} × ${inr(prev.aov)} → ${n0(cur.orders)} × ${inr(cur.aov)}.`],
      causes: [{ text: dAov < 0 ? "Growth is coming from smaller baskets (new, cheaper segments or regions)." : "Fewer but larger orders — check whether small-basket customers are being lost.", status: "hypothesis", confidence: "medium" }],
      levers: ["Basket-building for new customers", "Acquisition mix"],
      action: dAov < 0 ? "Protect the extra volume; add basket-building nudges for under-₹200 carts rather than raising minimum order values." : "Check whether small-basket orders fell because of a fee, threshold or stock change before celebrating the AOV gain.",
      impact: `Revenue moved ${revChange !== null ? spct(revChange) : "—"} (${inr(prev.revenue)} → ${inr(cur.revenue)}).`,
      followUp: "Fresh revenue per day (orders × AOV), weekly.",
      weight: 4e8,
    });
  }
  return out.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}
