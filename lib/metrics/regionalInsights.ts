// Rule-based insights for the Regional page: Meta spend vs where new sales come from, Priority Mumbai coverage and
// Tier 3 expansion. Pure: no I/O, no AI. Same WHAT → EVIDENCE → CAUSE → LEVERS → ACTION → IMPACT shape as
// lib/metrics/actionInsights.ts, so it renders in the same InsightPanel.
//
// Meta does not report spend by pincode (the old region breakdown, "Meta_AdSpent".ads_insights_region, stopped before
// adwatch coverage began), so spend is grouped by the location written in the ad set / campaign name. That is the
// INTENDED audience, not where the ads actually delivered: an ad set without a location in its name can reach anyone.
// Meta drives self-serve APP orders; WEB orders are sales-assisted, so spend is compared with APP orders.

import { PRIORITY_MUMBAI_PINCODES, TIER_LABEL, type RegionTier } from "../geo/regions.ts";
import type { MetaAdDailyRow, RegionalNewRow } from "../types/schemas";
import type { ActionInsight } from "./actionInsights.ts";
import type { RegionalMetrics } from "./regional.ts";

export type SpendTargeting = "mumbai" | "metros" | "maharashtra" | "broad";

export const TARGETING_ORDER: readonly SpendTargeting[] = ["mumbai", "metros", "maharashtra", "broad"];

export const TARGETING_LABEL: Record<SpendTargeting, string> = {
  mumbai: "Mumbai (Mum / Mumbai)",
  metros: "Metros / Tier 1 (Metro / T1)",
  maharashtra: "Maharashtra / Marathi (MH / Marathi)",
  broad: "No location in name",
};

const tok = (re: string) => new RegExp(`(^|[^a-z0-9])(${re})([^a-z0-9]|$)`, "i");
const MUMBAI = tok("mum|mumbai|mmr");
const METROS = tok("metro|metros|t1|tier1|tier-1");
const MAHARASHTRA = tok("mh|maharashtra|marathi");

/** Location intent of an ad set, read from its name (then its campaign's name). First match wins. */
export function targetingOf(adset: string | null, campaign: string | null): SpendTargeting {
  for (const name of [adset ?? "", campaign ?? ""]) {
    const s = name.replace(/_/g, " ");
    if (MUMBAI.test(s) || /mumbai/i.test(name)) return "mumbai";
    if (METROS.test(s)) return "metros";
    if (MAHARASHTRA.test(s)) return "maharashtra";
  }
  return "broad";
}

export interface SpendRow {
  group: SpendTargeting;
  label: string;
  spend: number;
  share: number | null;
  share_prev: number | null;
  share_change: number | null;
  ad_sets: number;
  top_ad_set: string | null;
}

export function buildSpendByTargeting(rows: readonly MetaAdDailyRow[], prevRows: readonly MetaAdDailyRow[] | null): SpendRow[] {
  const sum = (rs: readonly MetaAdDailyRow[]) => {
    const by = new Map<SpendTargeting, { spend: number; adsets: Map<string, number> }>();
    for (const r of rs) {
      if (!(r.spend > 0)) continue;
      const g = targetingOf(r.adset_name, r.campaign_name);
      const b = by.get(g) ?? { spend: 0, adsets: new Map<string, number>() };
      b.spend += r.spend;
      const k = r.adset_name ?? r.adset_id;
      b.adsets.set(k, (b.adsets.get(k) ?? 0) + r.spend);
      by.set(g, b);
    }
    return by;
  };
  const cur = sum(rows);
  const prev = prevRows ? sum(prevRows) : null;
  const total = [...cur.values()].reduce((s, b) => s + b.spend, 0);
  const totalPrev = prev ? [...prev.values()].reduce((s, b) => s + b.spend, 0) : 0;
  return TARGETING_ORDER.map((g) => {
    const b = cur.get(g);
    const share = total ? (b?.spend ?? 0) / total : null;
    const sharePrev = prev && totalPrev ? (prev.get(g)?.spend ?? 0) / totalPrev : null;
    const top = b ? [...b.adsets].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null : null;
    return {
      group: g,
      label: TARGETING_LABEL[g],
      spend: Math.round(b?.spend ?? 0),
      share,
      share_prev: sharePrev,
      share_change: share !== null && sharePrev !== null ? share - sharePrev : null,
      ad_sets: b?.adsets.size ?? 0,
      top_ad_set: top,
    };
  });
}

// ---------- New markets ----------

export interface NewMarketsView {
  /** One row per date: new pincodes per tier (keys = tier ids) — for a stacked daily chart. */
  dailyPins: Record<string, string | number | null>[];
  /** One row per date: new Tier 3 areas and pincodes. */
  dailyTier3: { date: string; new_areas: number; new_pins: number; orders: number }[];
  /** Range summary per tier. */
  byTier: (RegionalNewRow & { label: string; pins_per_day: number; areas_per_day: number; new_order_share: number | null })[];
  /** New Tier 3 areas in the range, most orders first. */
  newTier3Areas: RegionalNewRow[];
}

export function buildNewMarketsView(rows: readonly RegionalNewRow[], dates: readonly string[], tierOrders: readonly RegionalMetrics[]): NewMarketsView {
  const days = Math.max(dates.length, 1);
  const daily = rows.filter((r) => r.level === "daily");
  const at = (date: string, tier: string) => daily.find((r) => r.key === date && r.group === tier);
  const tiers: RegionTier[] = ["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3"];
  const dailyPins = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const t of tiers) row[t] = at(date, t)?.new_pins ?? 0;
    return row;
  });
  const dailyTier3 = dates.map((date) => {
    const r = at(date, "tier_3");
    return { date, new_areas: r?.new_areas ?? 0, new_pins: r?.new_pins ?? 0, orders: r?.orders ?? 0 };
  });
  const byTier = rows
    .filter((r) => r.level === "range")
    .map((r) => {
      const orders = tierOrders.find((t) => t.group === r.group)?.fresh_orders ?? 0;
      return {
        ...r,
        label: TIER_LABEL[r.group as RegionTier] ?? r.group,
        pins_per_day: Math.round((r.new_pins / days) * 10) / 10,
        areas_per_day: Math.round((r.new_areas / days) * 10) / 10,
        new_order_share: orders ? r.orders / orders : null,
      };
    });
  const newTier3Areas = rows
    .filter((r) => r.level === "area" && r.group === "tier_3")
    .sort((a, b) => b.orders - a.orders || (a.first_date! < b.first_date! ? 1 : -1));
  return { dailyPins, dailyTier3, byTier, newTier3Areas };
}

// ---------- Insights ----------

export interface RegionalInsightInput {
  tiers: readonly RegionalMetrics[];
  prevTiers: readonly RegionalMetrics[] | null;
  /** Daily Fresh orders by tier (RegionalView.daily). */
  daily: readonly Record<string, string | number | null>[];
  spend: readonly SpendRow[] | null;
  metaConnected: boolean;
  newMarkets: NewMarketsView | null;
  days: number;
}

const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const pts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))} pts`;
const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const div = (a: number, b: number) => (b ? a / b : null);

const MIN_ORDERS = 20;

export function buildRegionalInsights(input: RegionalInsightInput): ActionInsight[] {
  const out: ActionInsight[] = [];
  const tier = (t: RegionTier) => input.tiers.find((x) => x.group === t);
  const prevTier = (t: RegionTier) => input.prevTiers?.find((x) => x.group === t);
  const pm = tier("priority_mumbai");
  const t3 = tier("tier_3");
  const total = input.tiers.reduce((s, t) => s + t.fresh_orders, 0);
  const totalApp = input.tiers.reduce((s, t) => s + t.fresh_app, 0);
  const totalWeb = total - totalApp;
  const prevTotal = input.prevTiers?.reduce((s, t) => s + t.fresh_orders, 0) ?? 0;
  const share = (m: RegionalMetrics | undefined) => div(m?.fresh_orders ?? 0, total);
  const appShare = (m: RegionalMetrics | undefined) => div(m?.fresh_app ?? 0, totalApp);
  const prevShare = (m: RegionalMetrics | undefined) => (input.prevTiers && prevTotal ? (m?.fresh_orders ?? 0) / prevTotal : null);

  // ---------- 1. Spend vs where APP orders come from ----------
  if (!input.metaConnected) {
    out.push({
      id: "regional-meta-missing",
      kind: "tracking",
      priority: 2,
      affects: "Spend by targeted location",
      title: "Meta spend is not readable, so spend cannot be compared with regional sales",
      evidence: ["adwatch.meta_ad_daily did not return data for this period."],
      causes: [{ text: "The dashboard's service key has no read access to adwatch, or the collector has not run.", status: "hypothesis", confidence: "medium" }],
      levers: ["Database read access"],
      action: "Check the Meta ads page; once it shows spend, this panel compares spend with regional orders.",
      impact: "Unblocks the spend vs Priority Mumbai comparison.",
      followUp: "Spend by targeted location shows values.",
      weight: 1e8,
    });
  } else if (input.spend) {
    const totalSpend = input.spend.reduce((s, r) => s + r.spend, 0);
    const g = (k: SpendTargeting) => input.spend!.find((r) => r.group === k)!;
    const mum = g("mumbai");
    const notMumbai = 1 - (mum.share ?? 0);
    const pmApp = appShare(pm);
    const t3App = appShare(t3);
    if (totalSpend > 0 && pm && t3) {
      const perApp = div(totalSpend, totalApp);
      const evidence = [
        `Meta spend ${inr(totalSpend)} in ${input.days} day${input.days === 1 ? "" : "s"} (${inr(totalSpend / input.days)}/day): ` +
          input.spend.filter((r) => r.spend > 0).map((r) => `${r.label} ${pct(r.share ?? 0)}`).join(", ") + ".",
        `Of ${n(totalApp)} self-serve APP Fresh orders, Priority Mumbai pincodes placed ${n(pm.fresh_app)} (${pct(pmApp ?? 0)}) and Tier 3 placed ${n(t3.fresh_app)} (${pct(t3App ?? 0)}).`,
      ];
      if (perApp !== null) evidence.push(`Blended Meta spend per APP Fresh order: ${inr(perApp)} (all spend ÷ all APP Fresh orders; Meta does not attribute orders to pincodes).`);
      if (mum.share !== null && pm.fresh_app > 0) {
        evidence.push(`If every rupee in Mumbai-named ad sets produced only Priority Mumbai APP orders, each one cost ${inr(mum.spend / pm.fresh_app)} — an upper bound, not a measured CAC.`);
      }
      if (mum.share_change !== null) evidence.push(`Mumbai-named share of spend vs the previous period: ${pts(mum.share_change)}.`);
      const misaligned = (t3App ?? 0) >= (pmApp ?? 0) || notMumbai >= 0.5;
      out.push({
        id: "regional-spend-vs-priority",
        kind: "performance",
        priority: misaligned ? 1 : 2,
        affects: "Priority Mumbai APP orders, Meta spend allocation",
        title: `${pct(notMumbai)} of Meta spend is in ad sets not restricted to Mumbai; Tier 3 gets ${pct(t3App ?? 0)} of APP orders vs ${pct(pmApp ?? 0)} for Priority Mumbai`,
        evidence,
        causes: [
          {
            text: `Ad sets with no location (${pct(g("broad").share ?? 0)} of spend: creative tests, net-new-customer, retargeting) and Maharashtra / Marathi ad sets (${pct(g("maharashtra").share ?? 0)}) let Meta deliver wherever installs are cheapest, which is typically smaller towns.`,
            status: "hypothesis",
            confidence: "medium",
          },
          { text: "Spend is grouped by the location in the ad set name; actual delivery by location is not available, so a Mumbai-named ad set may still reach outside the priority pincodes.", status: "confirmed", confidence: "high" },
        ],
        levers: ["Location targeting of creative-test and broad ad sets", "Budget split between Mumbai and state-wide ad sets", "Pincode / radius targeting around the priority list"],
        action: "Restrict creative-test and net-new-customer ad sets to Mumbai (or the priority pincodes' radius), and cap Maharashtra-wide / Marathi ad sets to a fixed share of daily budget.",
        impact: `Every 10 points of spend share moved to Mumbai-targeted ad sets is about ${inr((totalSpend / input.days) * 0.1)}/day of budget redirected at current spend.`,
        followUp: "Priority Mumbai share of APP Fresh orders, week on week, alongside the Mumbai-named share of spend.",
        weight: 1e7,
      });
    }
  }

  // ---------- 2. Tier 3 vs Priority Mumbai share of new sales ----------
  if (pm && t3 && total >= MIN_ORDERS) {
    const pmS = share(pm)!;
    const t3S = share(t3)!;
    const pmPrev = prevShare(prevTier("priority_mumbai"));
    const t3Prev = prevShare(prevTier("tier_3"));
    const evidence = [
      `Fresh orders: Priority Mumbai ${n(pm.fresh_orders)} (${pct(pmS)}), Tier 3 ${n(t3.fresh_orders)} (${pct(t3S)}) of ${n(total)}.`,
      `Fresh revenue: Priority Mumbai ${inr(pm.revenue)}, Tier 3 ${inr(t3.revenue)}.`,
    ];
    if (pmPrev !== null && t3Prev !== null) evidence.push(`Share vs the previous period: Priority Mumbai ${pts(pmS - pmPrev)} (was ${pct(pmPrev)}), Tier 3 ${pts(t3S - t3Prev)} (was ${pct(t3Prev)}).`);
    const ratio = div(t3.fresh_orders, pm.fresh_orders);
    out.push({
      id: "regional-share",
      kind: "performance",
      priority: t3S > pmS ? 1 : pmPrev !== null && pmS < pmPrev - 0.03 ? 2 : 3,
      affects: "Priority Mumbai share of Fresh orders",
      title:
        t3S > pmS
          ? `Tier 3 out-sells Priority Mumbai: ${pct(t3S)} vs ${pct(pmS)} of Fresh orders${ratio ? ` (${ratio.toFixed(1)} Tier 3 orders per priority order)` : ""}`
          : `Priority Mumbai leads with ${pct(pmS)} of Fresh orders; Tier 3 is ${pct(t3S)}`,
      evidence,
      causes: [{ text: "Order mix follows where spend delivers (see the spend insight) more than the priority list.", status: "hypothesis", confidence: "medium" }],
      levers: ["Meta location targeting", "Sales-assisted (WEB) focus on priority pincodes", "Mumbai-specific offers / delivery promise"],
      action: "Set a weekly target for Priority Mumbai share of Fresh orders and review it with the spend split every Monday.",
      impact: `Each 5 points of share is about ${n(total * 0.05)} Fresh orders over this period at today's volume.`,
      followUp: "Priority Mumbai share of Fresh orders (KPI above).",
      weight: 9e6,
    });
  }

  // ---------- 3. Priority pincode coverage ----------
  const nm = input.newMarkets;
  const pmNew = nm?.byTier.find((r) => r.group === "priority_mumbai");
  if (pmNew && pmNew.active_pins !== null && pmNew.ever_pins !== null) {
    const listSize = PRIORITY_MUMBAI_PINCODES.size;
    const never = Math.max(listSize - pmNew.ever_pins, 0);
    const dormant = Math.max(pmNew.ever_pins - pmNew.active_pins, 0);
    out.push({
      id: "regional-priority-coverage",
      kind: "performance",
      priority: pmNew.active_pins / listSize < 0.5 ? 1 : 2,
      affects: "Priority Mumbai pincode coverage",
      title: `Only ${n(pmNew.active_pins)} of ${listSize} priority pincodes placed a Fresh order in this period; ${n(never)} have never ordered`,
      evidence: [
        `${n(pmNew.active_pins)} priority pincodes ordered in this period (${pct(pmNew.active_pins / listSize)} of the list).`,
        `${n(dormant)} have ordered before but not in this period; ${n(never)} have no eligible Fresh order since order history starts (25 Oct 2025).`,
        `${n(pmNew.new_pins)} priority pincode${pmNew.new_pins === 1 ? "" : "s"} placed a first-ever order in this period (${pmNew.pins_per_day}/day).`,
        "The list includes a few non-postal codes (e.g. 400000, 989898), so a handful can never order.",
      ],
      causes: [{ text: "Mumbai ad sets target the city as a whole, so budget concentrates where Meta finds the cheapest installs rather than across the priority list.", status: "hypothesis", confidence: "low" }],
      levers: ["Pincode-level targeting / custom location radius", "Local offline and sales-team activation in dormant pincodes"],
      action: "Export the priority pincode table below, list the dormant and never-ordered pincodes, and give them a dedicated ad set or sales-call list.",
      impact: `If half of the ${n(never + dormant)} silent priority pincodes placed one order a week, that is about ${n((never + dormant) / 2)} extra Priority Mumbai orders a week.`,
      followUp: "Active priority pincodes per period.",
      weight: 8e6,
    });
  }

  // ---------- 4. Tier 3 expansion (new areas per day) ----------
  const t3New = nm?.byTier.find((r) => r.group === "tier_3");
  if (t3New && t3 && t3.fresh_orders >= MIN_ORDERS) {
    const top = nm!.newTier3Areas.slice(0, 5).map((a) => `${a.key} (${a.orders})`);
    out.push({
      id: "regional-tier3-expansion",
      kind: "performance",
      priority: (t3New.new_order_share ?? 0) >= 0.3 ? 2 : 3,
      affects: "Tier 3 Fresh orders",
      title: `Tier 3 adds ${t3New.areas_per_day} new areas and ${t3New.pins_per_day} new pincodes a day; ${pct(t3New.new_order_share ?? 0)} of Tier 3 orders come from first-time pincodes`,
      evidence: [
        `${n(t3New.new_areas)} Tier 3 postal districts and ${n(t3New.new_pins)} Tier 3 pincodes placed their first-ever Fresh order in ${input.days} day${input.days === 1 ? "" : "s"}.`,
        `Tier 3 ordered from ${n(t3New.active_pins ?? 0)} pincodes in ${n(t3New.active_areas ?? 0)} districts this period — ${n(t3.fresh_orders)} orders, ${((t3.fresh_orders || 0) / Math.max(t3New.active_pins ?? 1, 1)).toFixed(1)} per pincode.`,
        ...(pmNew ? [`For comparison, Priority Mumbai added ${pmNew.pins_per_day} new pincodes a day.`] : []),
        ...(top.length ? [`Largest new Tier 3 areas: ${top.join(", ")}.`] : []),
      ],
      causes: [
        { text: "Sales are spreading thinly over many new places rather than deepening in existing ones — the pattern of broad, location-free delivery.", status: "hypothesis", confidence: "medium" },
      ],
      levers: ["Location exclusions on broad ad sets", "Delivery serviceability / RTO rules for remote pincodes"],
      action: "Decide whether Tier 3 expansion is wanted; if not, exclude Tier 3 locations from broad ad sets and watch whether total APP orders hold up.",
      impact: `${n(t3New.orders)} Tier 3 orders in this period came from pincodes that had never ordered before.`,
      followUp: "New Tier 3 areas per day (chart below).",
      weight: 7e6,
    });
  }

  // ---------- 5. Order quality: Tier 3 vs Priority Mumbai ----------
  if (pm && t3 && pm.fresh_orders >= MIN_ORDERS && t3.fresh_orders >= MIN_ORDERS) {
    const resolvedT3 = t3.delivered_orders + t3.rto_orders;
    const resolvedPm = pm.delivered_orders + pm.rto_orders;
    const evidence = [`AOV: Tier 3 ${t3.aov !== null ? inr(t3.aov) : "—"} vs Priority Mumbai ${pm.aov !== null ? inr(pm.aov) : "—"}.`];
    if (t3.rto_rate !== null && pm.rto_rate !== null) evidence.push(`RTO rate: Tier 3 ${pct(t3.rto_rate)} (${n(t3.rto_orders)} of ${n(resolvedT3)}) vs Priority Mumbai ${pct(pm.rto_rate)} (${n(pm.rto_orders)} of ${n(resolvedPm)}).`);
    if (t3.cancel_rate !== null && pm.cancel_rate !== null) evidence.push(`Cancellation rate: Tier 3 ${pct(t3.cancel_rate)} vs Priority Mumbai ${pct(pm.cancel_rate)}.`);
    const rtoWorse = (t3.rto_rate ?? 0) - (pm.rto_rate ?? 0) >= 0.05;
    const cancelWorse = (t3.cancel_rate ?? 0) - (pm.cancel_rate ?? 0) >= 0.05;
    const worse = rtoWorse || cancelWorse;
    out.push({
      id: "regional-tier3-quality",
      kind: "performance",
      priority: worse ? 2 : 3,
      affects: "RTO, cancellations and AOV by tier",
      title: rtoWorse
        ? `Tier 3 RTO rate is ${pct(t3.rto_rate!)} vs ${pct(pm.rto_rate!)} in Priority Mumbai: more Tier 3 orders come back undelivered`
        : cancelWorse
          ? `Tier 3 cancels ${pct(t3.cancel_rate!)} of placed orders vs ${pct(pm.cancel_rate!)} in Priority Mumbai`
          : `Tier 3 order quality is close to Priority Mumbai (RTO, cancellations, AOV)`,
      evidence,
      causes: [{ text: "Longer delivery routes and COD-heavy demand in smaller towns raise RTO and cancellations.", status: "hypothesis", confidence: "low" }],
      levers: ["Prepaid nudges / COD rules for Tier 3", "Courier choice by pincode"],
      action: worse ? "Include RTO and cancellations when judging Tier 3 spend: count only delivered orders when comparing cost per order by tier." : "No action; keep watching as Tier 3 volume grows.",
      impact:
        t3.rto_rate !== null && t3.aov !== null
          ? `At the current Tier 3 RTO rate, about ${inr(t3.aov * t3.rto_rate * t3.fresh_orders)} of this period's Tier 3 revenue is at risk of coming back.`
          : "—",
      followUp: "RTO and cancellation rate by tier (chart below).",
      weight: 6e6,
    });
  }

  // ---------- 6. Priority Mumbai cancellations ----------
  const placedAll = input.tiers.reduce((s, t) => s + t.placed_orders, 0);
  const cancelledAll = input.tiers.reduce((s, t) => s + t.cancelled_orders, 0);
  const cancelAll = div(cancelledAll, placedAll);
  if (pm && pm.cancel_rate !== null && cancelAll !== null && pm.placed_orders >= MIN_ORDERS && pm.cancel_rate - cancelAll >= 0.05) {
    out.push({
      id: "regional-priority-cancellations",
      kind: "performance",
      priority: 1,
      affects: "Priority Mumbai Fresh orders (cancellation rate)",
      title: `${pct(pm.cancel_rate)} of placed Priority Mumbai orders are cancelled vs ${pct(cancelAll)} overall`,
      evidence: [
        `Priority Mumbai: ${n(pm.cancelled_orders)} of ${n(pm.placed_orders)} placed Fresh orders cancelled (DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT).`,
        ...(t3 && t3.cancel_rate !== null ? [`Tier 3: ${n(t3.cancelled_orders)} of ${n(t3.placed_orders)} (${pct(t3.cancel_rate)}).`] : []),
        `Recovering half of them would add about ${n(pm.cancelled_orders / 2)} Priority Mumbai Fresh orders, ${pct(div(pm.cancelled_orders / 2, total) ?? 0)} of all Fresh orders this period.`,
      ],
      causes: [
        { text: "Same-day / fast-delivery expectations in Mumbai not met (stock or rider availability), so customers cancel.", status: "hypothesis", confidence: "low" },
        { text: "Duplicate or test orders placed and cancelled by the sales team.", status: "hypothesis", confidence: "low" },
      ],
      levers: ["Stock availability for Mumbai", "Delivery promise and rider capacity", "Cancellation reason capture"],
      action: "Pull cancellation reasons for Priority Mumbai orders this period and fix the top reason; these are customers already won in the target market.",
      impact: `${n(pm.cancelled_orders)} lost Priority Mumbai orders in this period.`,
      followUp: "Cancellation rate for Priority Mumbai (tier table).",
      weight: 8.5e6,
    });
  }

  // ---------- 7. Channel mix: who sells in Mumbai ----------
  if (pm && t3 && pm.fresh_orders >= MIN_ORDERS && t3.fresh_orders >= MIN_ORDERS && pm.web_share !== null && t3.web_share !== null && Math.abs(pm.web_share - t3.web_share) >= 0.1) {
    out.push({
      id: "regional-channel-mix",
      kind: "performance",
      priority: 3,
      affects: "APP vs WEB mix by tier",
      title: `${pct(pm.web_share)} of Priority Mumbai Fresh orders are sales-assisted WEB vs ${pct(t3.web_share)} in Tier 3`,
      evidence: [
        `Priority Mumbai: ${n(pm.fresh_app)} APP, ${n(pm.fresh_web)} WEB. Tier 3: ${n(t3.fresh_app)} APP, ${n(t3.fresh_web)} WEB.`,
        `Overall: ${n(totalApp)} APP, ${n(totalWeb)} WEB.`,
      ],
      causes: [
        pm.web_share > t3.web_share
          ? { text: "The sales team carries more of Mumbai's new sales, while paid APP demand leans towards Tier 3.", status: "hypothesis", confidence: "medium" }
          : { text: "Tier 3 relies more on the sales team, while Mumbai converts self-serve in the app.", status: "hypothesis", confidence: "medium" },
      ],
      levers: ["Sales-team allocation by tier", "App onboarding for Mumbai users"],
      action: "Read the spend insight together with this one: APP orders are what Meta spend buys, so compare spend with APP orders by tier.",
      impact: "—",
      followUp: "WEB share by area (All areas table).",
      weight: 5e6,
    });
  }

  // ---------- 8. Momentum: the last 7 days vs the whole range ----------
  if (input.daily.length >= 14 && pm) {
    const last = input.daily.slice(-7);
    const sum = (rows: readonly Record<string, string | number | null>[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const all = (rows: readonly Record<string, string | number | null>[]) =>
      ["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3", "unverified"].reduce((s, k) => s + sum(rows, k), 0);
    const lastTotal = all(last);
    const pmLast = div(sum(last, "priority_mumbai"), lastTotal);
    const t3Last = div(sum(last, "tier_3"), lastTotal);
    const pmS = share(pm);
    if (pmLast !== null && pmS !== null && lastTotal >= MIN_ORDERS && Math.abs(pmLast - pmS) >= 0.03) {
      out.push({
        id: "regional-momentum",
        kind: "performance",
        priority: pmLast < pmS ? 2 : 3,
        affects: "Priority Mumbai share of Fresh orders",
        title: `Priority Mumbai share in the last 7 days: ${pct(pmLast)} vs ${pct(pmS)} for the whole period (${pmLast < pmS ? "falling" : "rising"})`,
        evidence: [
          `Last 7 days: ${n(sum(last, "priority_mumbai"))} Priority Mumbai and ${n(sum(last, "tier_3"))} Tier 3 of ${n(lastTotal)} Fresh orders${t3Last !== null ? ` (Tier 3 ${pct(t3Last)})` : ""}.`,
        ],
        causes: [{ text: "A recent change in budget or ad sets (check the Meta ads page for ad sets launched or scaled in the last week).", status: "hypothesis", confidence: "low" }],
        levers: ["Recent budget changes"],
        action: "Compare the ad sets launched or scaled in the last 7 days with the daily tier chart below.",
        impact: "—",
        followUp: "Daily Fresh orders by tier.",
        weight: 4e6,
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}
