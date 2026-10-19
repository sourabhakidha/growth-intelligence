// Rule-based, explainable action insights for the Overview and App Funnel pages. Pure: no I/O, no AI.
//
// Each insight follows WHAT HAPPENED → EVIDENCE → LIKELY CAUSE(S) → LEVERS → SPECIFIC ACTION → BUSINESS IMPACT, and
// says which metric / stage it affects, whether each cause is confirmed or a hypothesis (with confidence), and the
// follow-up metric to watch. Impact numbers are arithmetic sensitivities at current conversion rates — never a
// forecast or a claimed uplift. Tracking / data-quality problems are kept separate from performance changes.

import type { StageView } from "./funnel.ts";

export type Confidence = "high" | "medium" | "low";

export interface ActionInsight {
  id: string;
  kind: "performance" | "tracking";
  /** 1 = act now, 2 = this week, 3 = monitor. */
  priority: 1 | 2 | 3;
  /** Metric or funnel stage affected. */
  affects: string;
  /** What happened. */
  title: string;
  evidence: string[];
  causes: { text: string; status: "confirmed" | "hypothesis"; confidence: Confidence }[];
  levers: string[];
  action: string;
  impact: string;
  followUp: string;
  /** Used for ranking: orders (or order-equivalents) at stake. */
  weight: number;
}

export interface SalesSnapshot {
  orders: number; // unique eligible Fresh orders
  app: number;
  web: number;
  customers: number; // distinct Fresh customers
  revenue: number;
}

export interface InsightInput {
  sales: SalesSnapshot | null;
  salesPrev: SalesSnapshot | null;
  /** Meta spend (all campaigns) for the range / previous range; null when Meta data is not connected. */
  spend: number | null;
  spendPrev: number | null;
  metaConnected: boolean;
  af: {
    stages: StageView[];
    paymentFailed: { value: number | null; rate: number | null };
    atcNew: number | null;
    atcRepeat: number | null;
    /** Previous period fully inside AppsFlyer coverage. */
    comparable: boolean;
  } | null;
  afCoverageNote: string | null;
  ga4Connected: boolean;
  ga4Incomplete: boolean;
}

const pct = (x: number) => `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const n = (x: number) => Math.round(x).toLocaleString("en-IN");
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;
const chg = (cur: number, prev: number) => (prev === 0 ? null : (cur - prev) / prev);

/** Stage-specific causes and levers. Hypotheses only — none is confirmed by the data available today. */
const STAGE_PLAYBOOK: Record<string, { causes: string[]; levers: string[]; action: string }> = {
  af_search: {
    causes: ["Installs from campaigns that bring low-intent users (installs that never open search)", "Onboarding / OTP friction before the user reaches search"],
    levers: ["Creative and audience targeting for intent", "Onboarding and OTP flow"],
    action: "Split install → search by campaign / ad in AppsFlyer and pause or rework the ads whose installs rarely reach search.",
  },
  af_add_to_cart: {
    causes: ["Searches that return no or poor results for the medicine looked for", "Price or delivery promise not competitive on the product page", "Prescription requirement shown late"],
    levers: ["Search relevance and zero-result handling", "Availability / substitutes", "Price and delivery messaging on the product page"],
    action: "Pull the top searched terms that do not lead to add-to-cart for this period and fix zero-result and out-of-stock terms first.",
  },
  af_initiated_checkout: {
    causes: ["Cart-page surprises (delivery fee, minimum order, prescription upload)", "Users comparing prices and leaving"],
    levers: ["Cart-page fees and messaging", "Abandoned-cart follow-up (CRM handoff)"],
    action: "Review cart → checkout for the top carted products and check that abandoned carts reach the CRM handoff within 30 minutes.",
  },
  payment_attempted: {
    causes: ["Checkout form or address step friction before payment"],
    levers: ["Checkout form length, address autofill"],
    action: "Instrument the checkout steps between checkout start and payment to find where users stop.",
  },
  af_purchase: {
    causes: ["Payment failures (gateway, UPI, card declines)"],
    levers: ["Payment retry and alternate methods, COD availability"],
    action: "Break Payment_failed down by payment method and gateway error code and fix the top failure reason first.",
  },
  First_Purchase: {
    causes: ["A growing share of purchases are from returning customers (expected as the base grows)"],
    levers: ["New-customer offers and onboarding"],
    action: "Track the new vs repeat share of purchases weekly; no action unless new-customer purchases fall.",
  },
};

export function buildActionInsights(input: InsightInput): ActionInsight[] {
  const out: ActionInsight[] = [];
  const { sales, salesPrev, af } = input;

  // ---------- Tracking / data quality ----------
  if (!input.metaConnected) {
    out.push({
      id: "meta-not-connected",
      kind: "tracking",
      priority: 1,
      affects: "CAC per Fresh order, CAC per Fresh customer",
      title: "CAC cannot be calculated: Meta spend is not readable by the dashboard",
      evidence: ["adwatch.meta_ad_daily returns 'permission denied' for the dashboard's service key."],
      causes: [{ text: "The service_role has no SELECT grant on schema adwatch.", status: "confirmed", confidence: "high" }],
      levers: ["Database read access"],
      action: "Run the three read-only GRANT statements in the README (Supabase SQL editor).",
      impact: "Unblocks order-based and customer-based CAC and links every funnel insight to Meta spend.",
      followUp: "CAC per Fresh order shows a value on the Overview.",
      weight: 1e9,
    });
  }
  if (!input.ga4Connected) {
    out.push({
      id: "ga4-not-connected",
      kind: "tracking",
      priority: 2,
      affects: "All-user (GA4) funnel",
      title: "All-user funnel unavailable: GA4 export is not readable by the dashboard",
      evidence: ["bigquery_data.app_funnel_daily returns 'permission denied' for the dashboard's service key."],
      causes: [{ text: "The service_role has no SELECT grant on the foreign table.", status: "confirmed", confidence: "high" }],
      levers: ["Database read access"],
      action: "Run the GRANT on bigquery_data.app_funnel_daily from the README.",
      impact: "Adds organic users to the funnel; today only paid (AppsFlyer) users are visible.",
      followUp: "GA4 funnel renders on the App Funnel page.",
      weight: 1e8,
    });
  }
  if (input.afCoverageNote) {
    out.push({
      id: "af-coverage",
      kind: "tracking",
      priority: 3,
      affects: "Funnel period-over-period comparison",
      title: "Funnel changes vs the previous period are not available yet",
      evidence: [input.afCoverageNote],
      causes: [{ text: "AppsFlyer raw events start on 6 Oct 2026.", status: "confirmed", confidence: "high" }],
      levers: ["Date range"],
      action: "Use a range starting on or after the coverage date plus its own length (e.g. last 7 days) to compare funnel periods.",
      impact: "Without a comparable period, stage changes cannot be attributed to a date.",
      followUp: "Stage change columns populate.",
      weight: 1,
    });
  }

  // ---------- New Sales ----------
  if (sales && salesPrev && salesPrev.orders > 0) {
    const d = chg(sales.orders, salesPrev.orders)!;
    if (Math.abs(d) >= 0.1) {
      const dApp = sales.app - salesPrev.app;
      const dWeb = sales.web - salesPrev.web;
      const driver = Math.abs(dApp) >= Math.abs(dWeb) ? "APP (self-serve)" : "WEB (sales-assisted)";
      const spendNote =
        input.spend !== null && input.spendPrev !== null && input.spendPrev > 0
          ? `Meta spend ${chg(input.spend, input.spendPrev)! >= 0 ? "rose" : "fell"} ${pct(Math.abs(chg(input.spend, input.spendPrev)!))} in the same window.`
          : "Meta spend for the same window is not available, so the spend link cannot be checked.";
      out.push({
        id: "new-sales-change",
        kind: "performance",
        priority: d < 0 ? 1 : 3,
        affects: "New Sales (eligible Fresh orders)",
        title: `New Sales ${d < 0 ? "fell" : "rose"} ${pct(Math.abs(d))} vs the previous period (${n(salesPrev.orders)} → ${n(sales.orders)})`,
        evidence: [
          `APP ${n(salesPrev.app)} → ${n(sales.app)} (${dApp >= 0 ? "+" : ""}${n(dApp)}), WEB ${n(salesPrev.web)} → ${n(sales.web)} (${dWeb >= 0 ? "+" : ""}${n(dWeb)}).`,
          `Distinct Fresh customers ${n(salesPrev.customers)} → ${n(sales.customers)}.`,
          spendNote,
        ],
        causes: [
          { text: `Most of the change comes from ${driver} orders.`, status: "confirmed" as const, confidence: "high" as const },
          driver.startsWith("APP")
            ? { text: "A change in paid acquisition or in an app funnel stage (see the funnel insights).", status: "hypothesis" as const, confidence: "medium" as const }
            : { text: "Sales-team capacity or lead flow (cart-lead handoff) changed.", status: "hypothesis" as const, confidence: "medium" as const },
        ],
        levers: driver.startsWith("APP") ? ["Meta budget and creatives", "Weakest app funnel stage"] : ["Sales-team dialling capacity", "Cart-lead handoff"],
        action: driver.startsWith("APP")
          ? "Check the funnel stage with the biggest drop (below) and Meta delivery for the same dates before changing budget."
          : "Compare cart leads handed to sales and dialled for the same dates on the Cart Recovery page.",
        impact: `${n(Math.abs(sales.orders - salesPrev.orders))} New Sales ${d < 0 ? "lost" : "gained"} vs the previous period (${inr(Math.abs(sales.revenue - salesPrev.revenue))} Fresh revenue).`,
        followUp: "Eligible Fresh orders per day, APP vs WEB.",
        weight: Math.abs(sales.orders - salesPrev.orders),
      });
    }
    const aov = sales.orders ? sales.revenue / sales.orders : null;
    const aovPrev = salesPrev.orders ? salesPrev.revenue / salesPrev.orders : null;
    if (aov !== null && aovPrev !== null && Math.abs(chg(aov, aovPrev) ?? 0) >= 0.1) {
      const a = chg(aov, aovPrev)!;
      out.push({
        id: "aov-change",
        kind: "performance",
        priority: 2,
        affects: "AOV (eligible Fresh revenue ÷ eligible Fresh orders)",
        title: `Fresh AOV ${a < 0 ? "fell" : "rose"} ${pct(Math.abs(a))} (${inr(aovPrev)} → ${inr(aov)})`,
        evidence: [`Fresh revenue ${inr(salesPrev.revenue)} → ${inr(sales.revenue)} on ${n(salesPrev.orders)} → ${n(sales.orders)} orders.`],
        causes: [{ text: "Product / basket mix or discounting changed.", status: "hypothesis", confidence: "low" }],
        levers: ["Discount depth", "Basket-building (substitutes, chronic refills)"],
        action: "Compare discount and basket size of Fresh orders between the two periods before acting.",
        impact: `At current volume, each ₹10 of AOV ≈ ${inr(sales.orders * 10)} Fresh revenue in the range.`,
        followUp: "AOV (Fresh), weekly.",
        weight: Math.abs(aov - aovPrev) * sales.orders / Math.max(aov, 1),
      });
    }
  }

  // ---------- CAC ----------
  if (input.spend !== null && input.spendPrev !== null && sales && salesPrev && sales.orders && salesPrev.orders) {
    const cac = input.spend / sales.orders;
    const cacPrev = input.spendPrev / salesPrev.orders;
    const c = chg(cac, cacPrev);
    if (c !== null && Math.abs(c) >= 0.15) {
      const s = chg(input.spend, input.spendPrev) ?? 0;
      const o = chg(sales.orders, salesPrev.orders) ?? 0;
      out.push({
        id: "cac-change",
        kind: "performance",
        priority: c > 0 ? 1 : 3,
        affects: "CAC per Fresh order (Meta spend, all campaigns ÷ eligible Fresh APP + WEB orders)",
        title: `CAC per Fresh order ${c > 0 ? "rose" : "fell"} ${pct(Math.abs(c))} (${inr(cacPrev)} → ${inr(cac)})`,
        evidence: [`Meta spend ${s >= 0 ? "+" : ""}${pct(s)}; eligible Fresh orders ${o >= 0 ? "+" : ""}${pct(o)}.`],
        causes: [
          {
            text: Math.abs(s) > Math.abs(o) ? "Driven mainly by the spend change." : "Driven mainly by the change in Fresh orders.",
            status: "confirmed",
            confidence: "high",
          },
        ],
        levers: ["Campaign budgets", "Weakest funnel stage"],
        action: "Rank campaigns by spend change and AppsFlyer installs → first purchase before moving budget.",
        impact: `At current orders, each ₹10 of CAC ≈ ${inr(sales.orders * 10)} of Meta spend.`,
        followUp: "CAC per Fresh order and per Fresh customer, weekly.",
        weight: Math.abs(input.spend - cacPrev * sales.orders) / Math.max(cac, 1),
      });
    }
  }

  // ---------- App funnel (AppsFlyer, paid users) ----------
  if (af && af.stages.length) {
    const st = af.stages;
    const firstPurchase = st.find((s) => s.key === "First_Purchase")?.value ?? null;
    const atc = st.find((s) => s.key === "af_add_to_cart")?.value ?? null;
    const atcToFirst = firstPurchase !== null && atc ? firstPurchase / atc : null;

    // Where it got worse vs the previous period (first stage whose conversion fell ≥ 5 points).
    if (af.comparable) {
      const worse = st.find((s) => s.conv_prev !== null && s.conv_prev_period !== null && s.conv_prev_period - s.conv_prev >= 0.05);
      if (worse) {
        const play = STAGE_PLAYBOOK[worse.key];
        const before = st[st.indexOf(worse) - 1];
        const lost = before?.value ? (worse.conv_prev_period! - worse.conv_prev!) * before.value : 0;
        out.push({
          id: `stage-worse-${worse.key}`,
          kind: "performance",
          priority: 1,
          affects: `App funnel (AppsFlyer, paid users): ${before?.label} → ${worse.label}`,
          title: `${before?.label} → ${worse.label} conversion fell from ${pct(worse.conv_prev_period!)} to ${pct(worse.conv_prev!)}`,
          evidence: [
            `This is the first stage where conversion dropped by 5 points or more; earlier stages held.`,
            `≈ ${n(lost)} fewer devices reached "${worse.label}" than the previous-period rate would give.`,
          ],
          causes: (play?.causes ?? []).map((t) => ({ text: t, status: "hypothesis" as const, confidence: "medium" as const })),
          levers: play?.levers ?? [],
          action: play?.action ?? "Investigate this stage first.",
          impact: atcToFirst ? `Sensitivity, not a forecast: restoring the previous rate ≈ ${n(lost)} devices at this stage.` : "Impact cannot be sized without downstream conversion.",
          followUp: `${before?.label} → ${worse.label} conversion, daily.`,
          weight: lost,
        });
      }
    }

    // Biggest absolute drop-off (where the volume is lost).
    const biggest = st.slice(1).reduce<StageView | null>((w, s) => (s.drop !== null && !s.derived && (w === null || (w.drop ?? 0) < s.drop) ? s : w), null);
    if (biggest && biggest.key !== "af_search") {
      const play = STAGE_PLAYBOOK[biggest.key];
      const before = st[st.indexOf(biggest) - 1];
      const downstream = biggest.value && firstPurchase !== null ? firstPurchase / biggest.value : null;
      const plus1pp = before?.value ? before.value * 0.01 : null;
      out.push({
        id: `stage-drop-${biggest.key}`,
        kind: "performance",
        priority: 2,
        affects: `App funnel (AppsFlyer, paid users): ${before?.label} → ${biggest.label}`,
        title: `Largest drop-off: ${pct(biggest.drop_rate ?? 0)} of devices that reach "${before?.label}" never reach "${biggest.label}"`,
        evidence: [
          `${n(before?.value ?? 0)} → ${n(biggest.value ?? 0)} devices (${n(biggest.drop ?? 0)} lost).`,
          atcToFirst !== null ? `Of devices that add to cart, ${pct(atcToFirst)} end in a tracked first purchase.` : "",
        ].filter(Boolean),
        causes: (play?.causes ?? []).map((t) => ({ text: t, status: "hypothesis" as const, confidence: "medium" as const })),
        levers: play?.levers ?? [],
        action: play?.action ?? "Investigate this stage first.",
        impact:
          plus1pp !== null && downstream !== null
            ? `Sensitivity, not a forecast: +1 point at this step ≈ ${n(plus1pp)} more devices here ≈ ${n(plus1pp * downstream)} tracked first purchases at the current downstream rate.`
            : "Impact cannot be sized from the available data.",
        followUp: `${before?.label} → ${biggest.label} conversion, daily.`,
        weight: plus1pp !== null && downstream !== null ? plus1pp * downstream * 10 : 1,
      });
    }

    // Payment failures.
    const pf = af.paymentFailed;
    if (pf.value !== null && pf.rate !== null && pf.rate >= 0.15) {
      out.push({
        id: "payment-failures",
        kind: "performance",
        priority: pf.rate >= 0.25 ? 1 : 2,
        affects: "App funnel: Payment attempted → Payment successful",
        title: `${pct(pf.rate)} of paying devices hit a payment failure (${n(pf.value)} devices)`,
        evidence: [
          `Payment_failed devices ÷ payment-attempted devices (failed or purchased) in the range.`,
          "A device can fail and then succeed, so some of these recovered on retry.",
        ],
        causes: [
          { text: "Gateway / UPI / card declines.", status: "hypothesis", confidence: "medium" },
          { text: "Users abandoning at the payment step and the app logging it as a failure.", status: "hypothesis", confidence: "low" },
        ],
        levers: ["Retry flow and alternate payment methods", "COD availability", "Gateway routing"],
        action: "Break Payment_failed down by method and gateway error code; add a one-tap retry with an alternate method for the top failure reason.",
        impact: `Sensitivity, not a forecast: every 10% of failing devices recovered ≈ ${n(pf.value * 0.1)} more purchases.`,
        followUp: "Payment failure rate (failed ÷ attempted devices), daily.",
        weight: pf.value * 0.1 * 10,
      });
    }

    // New vs repeat add-to-cart.
    if (af.atcNew !== null && af.atcRepeat !== null && af.atcNew + af.atcRepeat > 0 && firstPurchase !== null && af.atcNew > 0) {
      const newToFirst = firstPurchase / af.atcNew;
      if (newToFirst < 0.25) {
        out.push({
          id: "new-customer-cart-conversion",
          kind: "performance",
          priority: 2,
          affects: "New-customer add-to-cart → first purchase",
          title: `Only ${pct(newToFirst)} of new-customer carts turn into a tracked first purchase`,
          evidence: [
            `${n(af.atcNew)} new-customer and ${n(af.atcRepeat)} repeat-customer users added to cart (repeat = completed order before their first add-to-cart).`,
            `${n(firstPurchase)} devices fired First_Purchase in the same range (same-period ratio, not a cohort).`,
          ],
          causes: [
            { text: "New customers hit prescription upload, delivery-fee or trust barriers that repeat customers already cleared.", status: "hypothesis", confidence: "medium" },
          ],
          levers: ["First-order offer", "Prescription help", "Abandoned-cart call within the 30-minute handoff"],
          action: "Check what share of new-customer carts reach the CRM within 30 minutes and are dialled (Cart Recovery page), and test a first-order incentive on the cart page.",
          impact: `Sensitivity, not a forecast: +5 points on new-customer cart conversion ≈ ${n(af.atcNew * 0.05)} more first purchases.`,
          followUp: "New-customer add-to-cart → first purchase, weekly.",
          weight: af.atcNew * 0.05 * 10,
        });
      }
    }
  }

  // Tracked first purchases vs business New Sales (APP).
  if (af && sales) {
    const fp = af.stages.find((s) => s.key === "First_Purchase")?.value ?? null;
    if (fp !== null && sales.app > 0) {
      const ratio = fp / sales.app;
      out.push({
        id: "tracking-vs-business",
        kind: "tracking",
        priority: ratio > 1 ? 1 : 3,
        affects: "Tracked first purchases vs eligible Fresh APP orders",
        title:
          ratio > 1
            ? `AppsFlyer reports more first purchases (${n(fp)}) than eligible Fresh APP orders (${n(sales.app)})`
            : `AppsFlyer first purchases cover ${pct(ratio)} of eligible Fresh APP orders (${n(fp)} vs ${n(sales.app)})`,
        evidence: [
          "AppsFlyer counts paid (non-organic) devices only; Fresh APP orders include organic users and exclude cancelled / prescription-only orders.",
        ],
        causes:
          ratio > 1
            ? [{ text: "First_Purchase fires before the order is confirmed (cancelled or prescription-only orders still fire it).", status: "hypothesis", confidence: "medium" }]
            : [{ text: "The rest are organic or untracked app users — expected while organic AppsFlyer ingest is off.", status: "hypothesis", confidence: "high" }],
        levers: ["Event firing point", "Organic ingest"],
        action:
          ratio > 1
            ? "Move First_Purchase to fire on order confirmation, then re-check this ratio."
            : "Use AppsFlyer for paid-channel diagnosis only; report New Sales from Order_Level_V4.",
        impact: "Keeps paid-channel funnel decisions from being read as total business performance.",
        followUp: "AppsFlyer First_Purchase ÷ Fresh APP orders, weekly.",
        weight: ratio > 1 ? 1e7 : 0.5,
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}
