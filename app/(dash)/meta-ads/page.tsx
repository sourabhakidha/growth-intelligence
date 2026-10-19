import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBars } from "@/components/charts/CategoryBars";
import { ChartCard } from "@/components/charts/ChartCard";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { DropOffBars, EfficiencyBars, FreshFunnel, KpiStrip, SectionTitle } from "@/components/meta/MetaPanels";
import { OpportunityMap } from "@/components/meta/OpportunityMap";
import { PerformanceTimeline } from "@/components/meta/PerformanceTimeline";
import { PeriodMatrix, matrixWindows, sameTimeMatrixWindows, type MatrixCell, type MatrixRow } from "@/components/kpi/PeriodMatrix";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getAfAdDaily, getAfCampaignDaily } from "@/lib/data/afEvents";
import { getCartLeadsDaily } from "@/lib/data/cartLeads";
import { getSourceFreshness } from "@/lib/data/freshness";
import { getMetaAdHistory, getMetaAf, getMetaSameTime } from "@/lib/data/metaAds";
import { getMetaSpendCheck } from "@/lib/data/metaCampaignCheck";
import { getOrdersDaily, getUniqueCustomers } from "@/lib/data/orders";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDate, formatDateShort, formatRange, todayIST } from "@/lib/format/ist";
import { formatMetric } from "@/lib/format/metric";
import {
  afClip,
  afWindowId,
  campaignDrivers,
  campaignEvents,
  efficiency,
  formatPerformance,
  freshFunnel,
  freshInsights,
  kpiStrip,
  kpiValues,
  opportunityMap,
  sameTimeFacts,
  spanLabel,
  timeline,
  windowFacts,
  type AfWindow,
  type TimelineEvent,
} from "@/lib/metrics/metaFresh";
import {
  ADWATCH_FROM,
  AF_COVERAGE_FROM,
  AF_FIRST_FULL_DAY,
  CLASS_LABEL,
  analyseCreatives,
  changeSignal,
  compareWindows,
  dailySeries,
  metaInsights,
  newSales,
  octCohort,
  spendMarkers,
  totals,
} from "@/lib/metrics/metaIntel";
import { NO_EARLIER_DAYS, sameTimeWindows } from "@/lib/metrics/sameTime";
import { dateSpine, rollupAds, withRates } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";
import type { DataResult } from "@/lib/types/result";
import type { OrdersUniqueCustomersRow } from "@/lib/types/schemas";

export const metadata: Metadata = { title: "Meta Ads" };

const ENTITY_COLUMNS = (nameLabel: string, parentLabel?: string): TableColumn[] => [
  { key: "name", label: nameLabel, format: "text" },
  ...(parentLabel ? [{ key: "parent", label: parentLabel, format: "text" } as TableColumn] : []),
  { key: "spend", label: "Spend", format: "inr" },
  { key: "spend_change", label: "Spend vs prev.", format: "pct" },
  { key: "impressions", label: "Impressions", format: "count" },
  { key: "cpm", label: "CPM", format: "inr_precise" },
  { key: "link_clicks", label: "Link clicks", format: "count" },
  { key: "ctr", label: "CTR (link)", format: "pct" },
  { key: "cpc", label: "CPC (link)", format: "inr_precise" },
  { key: "installs", label: "Installs (Meta)", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "cpi_change", label: "CPI vs prev.", format: "pct" },
  { key: "signal", label: "Signal", format: "text", hint: "Changes vs the previous period of the same length that deserve attention." },
];

const CHECK_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "adwatch_spend", label: "adwatch spend", format: "inr" },
  { key: "campaign_table_spend", label: "Campaign table spend", format: "inr" },
  { key: "diff", label: "Difference", format: "inr" },
  { key: "adwatch_impressions", label: "adwatch impressions", format: "count" },
  { key: "campaign_table_impressions", label: "Campaign table impressions", format: "count" },
];

const CREATIVE_COLUMNS: TableColumn[] = [
  { key: "name", label: "Creative", format: "text" },
  { key: "cohortLabel", label: "Cohort", format: "text" },
  { key: "class", label: "Assessment", format: "text" },
  { key: "reason", label: "Why", format: "text" },
  { key: "format", label: "Format", format: "text" },
  { key: "launch", label: "Launch", format: "date" },
  { key: "launchBasis", label: "Launch basis", format: "text" },
  { key: "daysLive", label: "Days live", format: "count" },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "spendShare", label: "Spend share", format: "pct" },
  { key: "cpm", label: "CPM", format: "inr_precise" },
  { key: "ctr", label: "CTR (link)", format: "pct" },
  { key: "cpc", label: "CPC", format: "inr_precise" },
  { key: "installs", label: "Installs (Meta)", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "cpi_vs_baseline", label: "CPI vs account", format: "pct" },
  { key: "cpi_trend", label: "CPI last 7d vs prior 7d", format: "pct" },
  { key: "hook_rate", label: "Hook rate", format: "pct" },
  { key: "af_installs", label: "AF installs", format: "count", hint: "AppsFlyer installs matched by ad name." },
  { key: "purchasers_per_install", label: "AF purchasers / install", format: "pct", hint: "AppsFlyer-attributed purchasers ÷ AppsFlyer installs. Not Fresh orders." },
];

const COHORT_COLUMNS: TableColumn[] = [
  { key: "group", label: "Group", format: "text" },
  { key: "live", label: "Live on Meta", format: "count" },
  { key: "judged", label: "Judged (≥ 10 installs)", format: "count" },
  { key: "winners", label: "Proven winners", format: "count" },
  { key: "winRate", label: "Winning rate", format: "pct", hint: "Proven winners ÷ creatives with enough data to judge." },
  { key: "emerging", label: "Emerging", format: "count" },
  { key: "struggling", label: "Struggling", format: "count", hint: "Underperforming, fatigue, high-spend underperformer or cheap installs / weak downstream." },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "installs", label: "Installs", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
];

const OCT_COLUMNS: TableColumn[] = [
  { key: "name", label: "October creative (list name)", format: "text" },
  { key: "match", label: "Matched to Meta ads", format: "text", hint: "exact = ad name names the creative; probable = matched by theme and launch batch." },
  { key: "ads", label: "Ads", format: "count" },
  { key: "format", label: "Format", format: "text" },
  { key: "launch", label: "First delivery", format: "date" },
  { key: "daysLive", label: "Days live", format: "count" },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "installs", label: "Installs", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "cpi_vs_baseline", label: "CPI vs account", format: "pct" },
  { key: "class", label: "Assessment", format: "text" },
  { key: "reason", label: "Why", format: "text" },
];

const DRIVER_COLUMNS: TableColumn[] = [
  { key: "short", label: "Campaign", format: "text" },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "spend_delta", label: "Δ Spend", format: "inr", hint: "Spend change vs the comparison period." },
  { key: "spend_delta_share", label: "Share of change", format: "pct", hint: "This campaign's share of the account's total absolute spend change." },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "af_atc", label: "AF add-to-cart users", format: "count", hint: "AppsFlyer add-to-cart users, all customers (Fresh split is not available by campaign)." },
  { key: "af_atc_change", label: "Δ ATC", format: "pct" },
  { key: "af_first_purchasers", label: "AF first purchasers", format: "count", hint: "AppsFlyer first-purchase users: AppsFlyer attribution, not Fresh orders and not Meta-reported purchases." },
  { key: "af_fp_change", label: "Δ First purchasers", format: "pct" },
  { key: "cost_per_af_fp", label: "CAC (per AF first purchaser)", format: "inr_precise" },
  { key: "cac_change", label: "Δ CAC", format: "pct" },
  { key: "driver", label: "Driver", format: "text" },
];

const FORMAT_COLUMNS: TableColumn[] = [
  { key: "format", label: "Format", format: "text" },
  { key: "creatives", label: "Creatives", format: "count" },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "spend_share", label: "Share", format: "pct" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "ctr", label: "CTR (link)", format: "pct" },
  { key: "af_purchasers", label: "AF purchasers", format: "count", hint: "AppsFlyer-attributed purchasers matched by ad name (all purchasers, not Fresh only)." },
  { key: "cost_per_af_purchaser", label: "Cost per AF purchaser", format: "inr_precise" },
];

const COHORT_LABEL = { oct: "October launch", pre_oct: "Before October", mixed: "Mixed-creative ad" } as const;

const freshCustomersOf = (r: DataResult<OrdersUniqueCustomersRow[]>) => (r.state === "ok" ? (r.data.find((x) => x.order_type === "Fresh")?.unique_customers_all ?? 0) : null);

export default async function MetaAdsPage({ searchParams }: PageProps<"/meta-ads">) {
  const sp = await searchParams;
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const today = todayIST();
  const yday = addDays(today, -1);
  // Same-time comparison: Now vs Yesterday / Last 7 days / MTD, every day counted only to the current IST minute.
  const now = new Date();
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const nowMinute = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  const hhmm = `${String(istNow.getUTCHours()).padStart(2, "0")}:${String(istNow.getUTCMinutes()).padStart(2, "0")}`;
  const stWindows = sameTimeWindows(today, hhmm);
  // Today / Yesterday / Last 7 days / MTD (anchored to today) + the selected range, each with its own comparison.
  const basePeriods = compareWindows(range, today);
  const last = range.to < today ? range.to : addDays(today, -1); // last complete day of the selected range
  const ordersFrom = [range.from, previous.from, ...basePeriods.map((p) => p.cmpFrom)].reduce((a, b) => (b < a ? b : a));

  // AppsFlyer windows: whole periods (only when fully covered) and the covered part of each window.
  const afWindows = basePeriods.flatMap((p) => {
    const out: { id: string; from: string; to: string }[] = [];
    const cur = afClip(p.from, p.to);
    const cmp = afClip(p.cmpFrom, p.cmpTo);
    if (cur) out.push({ id: afWindowId(p.id, "cur"), ...cur });
    if (cmp) out.push({ id: afWindowId(p.id, "cmp"), ...cmp });
    return out;
  });

  const [history, af, orders, afAds, check, leads, afCampaigns, custs, freshness, sameTime] = await Promise.all([
    getMetaAdHistory(today),
    getMetaAf(range, afWindows, { today, cutoffMinute: nowMinute }),
    getOrdersDaily({ from: ordersFrom, to: today }),
    getAfAdDaily(range),
    getMetaSpendCheck(range),
    getCartLeadsDaily({ from: ordersFrom, to: today }),
    getAfCampaignDaily({ from: ordersFrom, to: today }),
    // Distinct Fresh customers per window and per comparison (CAC denominator; never summed across windows).
    Promise.all(basePeriods.flatMap((p) => [getUniqueCustomers({ from: p.from, to: p.to }), getUniqueCustomers({ from: p.cmpFrom, to: p.cmpTo })])),
    getSourceFreshness(),
    getMetaSameTime(today, nowMinute),
  ]);

  const stRows = sameTime.state === "ok" ? sameTime.data : [];
  const stFacts = stWindows.map((x) => (x.days.length ? sameTimeFacts(stRows, af.state === "ok" ? af.data : null, x.days) : null));
  const [stNow, stYday] = stFacts;
  const stOk = stNow !== null && stYday !== null;
  const metaTo = stRows.length ? `${String(Math.floor(stRows[0].meta_minute / 60)).padStart(2, "0")}:${String(stRows[0].meta_minute % 60).padStart(2, "0")}` : hhmm;
  // With same-time data, "Today" is compared with yesterday to the same time instead of being left uncompared.
  const periods = stOk
    ? basePeriods.map((p) => (p.id === "today" ? { ...p, label: `Today to ${hhmm}`, cmpLabel: `vs yesterday to ${hhmm}`, partial: false } : p))
    : basePeriods;
  const periodParam = typeof sp.period === "string" ? sp.period : "mtd";
  const period = periods.find((p) => p.id === periodParam) ?? periods.find((p) => p.id === "mtd")!;

  const hist = history.state === "ok" ? history.data : [];
  const ordersRows = orders.state === "ok" ? orders.data : null;
  const leadRows = leads.state === "ok" ? leads.data : null;
  const afWin = new Map<string, AfWindow>((af.state === "ok" ? af.data : []).filter((r) => r.level === "window").map((r) => [r.key, r]));
  const afOk = af.state === "ok" || af.state === "empty";

  // ---------- 1–2. Key metrics: tiles for the chosen period, and every period side by side ----------
  const facts = periods.map((p, i) => ({
    cur: windowFacts(hist, p.from, p.to, afWin.get(afWindowId(p.id, "cur")) ?? null, leadRows, ordersRows, freshCustomersOf(custs[2 * i])),
    cmp: windowFacts(hist, p.cmpFrom, p.cmpTo, afWin.get(afWindowId(p.id, "cmp")) ?? null, leadRows, ordersRows, freshCustomersOf(custs[2 * i + 1])),
  }));
  const pi = periods.indexOf(period);
  const ti = periods.findIndex((p) => p.id === "today");
  if (stOk && ti >= 0) facts[ti] = { cur: stNow, cmp: stYday };
  const { cur: curFacts, cmp: cmpFacts } = facts[pi];
  const tilesBy = periods.map((p, i) => kpiStrip(p, facts[i].cur, facts[i].cmp));
  const tiles = tilesBy[pi].map((t) =>
    (t.key === "fresh_atc" || t.key === "cost_per_fresh_atc") && curFacts.afWindow ? { ...t, sub: `${t.sub} · from ${formatDateShort(AF_COVERAGE_FROM)}` } : t,
  );

  // Section 2 / 4 columns: Now, Yesterday, Last 7 days, MTD (same time of day) + the selected range (its own comparison).
  const ri = periods.findIndex((p) => p.id === "range");
  const matrixCols = [...sameTimeMatrixWindows(stWindows), ...matrixWindows(periods.slice(ri, ri + 1))];
  const stMissing = (i: number): MatrixCell => ({ value: null, noCmp: stWindows[i].days.length ? (sameTime.state === "ok" ? "no data" : "same-time data unavailable") : NO_EARLIER_DAYS });
  const stKpis = stFacts.map((f) => (f ? kpiValues(f) : null));
  const kpiRows: MatrixRow[] = tilesBy[0].map((t, r) => ({
    key: t.key,
    label: t.label,
    sub: t.sub,
    group: r < 7 ? "Meta delivery" : "Cost and Fresh outcomes",
    format: t.format,
    up: t.up,
    hint: t.hint,
    cells: [
      ...stKpis.map((k, i) => (k ? { value: k[r].value } : stMissing(i))),
      { value: tilesBy[ri][r].value, cmp: tilesBy[ri][r].cmp, noCmp: tilesBy[ri][r].noCmp },
    ],
  }));

  // ---------- 4. Funnel by period (AppsFlyer-covered days of each window and of its comparison) ----------
  const funnels = periods.map((p) => {
    const c = afClip(p.from, p.to);
    const m = afClip(p.cmpFrom, p.cmpTo);
    if (!c) return null;
    const fc = windowFacts(hist, c.from, c.to, afWin.get(afWindowId(p.id, "cur")) ?? null, leadRows, ordersRows, null);
    const fm = m ? windowFacts(hist, m.from, m.to, afWin.get(afWindowId(p.id, "cmp")) ?? null, leadRows, ordersRows, null) : null;
    // Counts compare only when both windows cover the same number of days; rates always compare.
    const countNoCmp =
      p.id === "today" ? "day in progress" : !m ? "before AppsFlyer data" : daysBetween(m.from, m.to) !== daysBetween(c.from, c.to) ? "partial comparison window" : null;
    return { view: freshFunnel(c, m, fc, fm), countNoCmp, rateNoCmp: m ? null : "before AppsFlyer data" };
  });
  const noAf = { value: null, noCmp: "before AppsFlyer data" };
  // Same-time funnels: AppsFlyer-covered days of each window, every day to the current time, per-day averages.
  const stFunnels = stFacts.map((f, i) => (f?.af ? freshFunnel(f.afWindow ?? { from: stWindows[i].days[0], to: stWindows[i].days[stWindows[i].days.length - 1] }, null, f, null) : null));
  const stFunnelCell = (i: number, v: (f: NonNullable<(typeof stFunnels)[number]>) => number | null): MatrixCell =>
    stFunnels[i] ? { value: v(stFunnels[i]) } : stFacts[i] ? noAf : stMissing(i);
  const rangeFunnel = funnels[ri];
  const funnelSteps = rangeFunnel?.view.steps ?? stFunnels.find((f) => f)?.steps ?? [];
  const funnelRows: MatrixRow[] = [
    ...funnelSteps.map((s, si): MatrixRow => ({
      key: s.key,
      label: s.label,
      sub: s.source === "Orders" ? "AppsFlyer users matched to Fresh orders" : s.source,
      group: "Volume",
      format: "count",
      up: true,
      cells: [
        ...stWindows.map((_, i) => stFunnelCell(i, (f) => f.steps[si].value)),
        rangeFunnel ? { value: rangeFunnel.view.steps[si].value, cmp: rangeFunnel.view.steps[si].prev, noCmp: rangeFunnel.countNoCmp } : noAf,
      ],
    })),
    {
      key: "checkout",
      label: "Fresh Checkout Initiated",
      sub: "AppsFlyer · context, not a funnel step",
      group: "Volume",
      format: "count",
      up: true,
      cells: [
        ...stWindows.map((_, i) => stFunnelCell(i, (f) => f.checkout)),
        rangeFunnel ? { value: rangeFunnel.view.checkout, cmp: rangeFunnel.view.checkoutPrev, noCmp: rangeFunnel.countNoCmp } : noAf,
      ],
    },
    ...funnelSteps.slice(1).map((s, si): MatrixRow => ({
      key: `conv_${s.key}`,
      label: `${funnelSteps[si].label} → ${s.label}`,
      group: "Step conversion",
      format: "pct",
      up: true,
      change: "points",
      cells: [
        ...stWindows.map((_, i) => stFunnelCell(i, (f) => f.steps[si + 1].conv)),
        rangeFunnel ? { value: rangeFunnel.view.steps[si + 1].conv, cmp: rangeFunnel.view.steps[si + 1].conv_prev, noCmp: rangeFunnel.rateNoCmp } : noAf,
      ],
    })),
  ];

  // ---------- 3. Timeline ----------
  const dates = dateSpine(range.from, range.to);
  const daily = dailySeries(hist, dates);
  const window = range.from <= last ? { from: range.from, to: last } : { from: addDays(last, -6), to: last };
  const creatives = history.state === "ok" ? analyseCreatives(hist, afAds.state === "ok" ? afAds.data : null, window) : null;
  const creativeEvents: TimelineEvent[] = creatives
    ? Object.entries(
        creatives.creatives
          .filter((c) => c.cohort === "oct" && c.launch >= range.from && (c.spendShare ?? 0) >= 0.02)
          .reduce<Record<string, string[]>>((m, c) => ({ ...m, [c.launch]: [...(m[c.launch] ?? []), c.name] }), {}),
      ).map(([date, names]) => ({ date, kind: "creative" as const, label: `New creative${names.length > 1 ? "s" : ""} live: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` }))
    : [];
  const events: TimelineEvent[] = [
    ...campaignEvents(hist, range.from, range.to, last),
    ...creativeEvents,
    ...spendMarkers(daily).map((m) => ({ date: m.date, kind: "spend_shift" as const, label: `${m.label} vs trailing 7-day average` })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const timelineData = timeline(hist, dates, af.state === "ok" ? af.data : null, ordersRows);

  // ---------- 3–5. Funnel, drop-off, efficiency (AppsFlyer-covered days of the period and its comparison) ----------
  const fCur = afClip(period.from, period.to);
  const fCmp = afClip(period.cmpFrom, period.cmpTo);
  const funnelCur = fCur ? windowFacts(hist, fCur.from, fCur.to, afWin.get(afWindowId(period.id, "cur")) ?? null, leadRows, ordersRows, null) : null;
  const funnelCmp = fCmp ? windowFacts(hist, fCmp.from, fCmp.to, afWin.get(afWindowId(period.id, "cmp")) ?? null, leadRows, ordersRows, null) : null;
  const funnel =
    period.id === "today" && stOk
      ? stNow.af
        ? freshFunnel({ from: today, to: today }, stYday.af ? { from: yday, to: yday } : null, stNow, stYday.af ? stYday : null)
        : null
      : fCur && funnelCur
        ? freshFunnel(fCur, fCmp, funnelCur, funnelCmp)
        : null;
  const eff = efficiency(curFacts, cmpFacts, period.cmpFrom >= ADWATCH_FROM);

  // ---------- 6. Campaign drivers ----------
  // Today vs yesterday: yesterday's campaign rows are cut to the same time with the account-level same-time ratio.
  const ydayFull = totals(hist.filter((r) => r.date === yday)).spend;
  const ydayCut = period.id === "today" && stOk && ydayFull ? stYday.meta.spend / ydayFull : null;
  const driverHist = ydayCut === null ? hist : hist.map((r) => (r.date === yday ? { ...r, spend: r.spend * ydayCut, installs: r.installs * ydayCut } : r));
  const driverAf = afCampaigns.state === "ok" ? (ydayCut === null ? afCampaigns.data : afCampaigns.data.map((r) => (r.date === yday ? { ...r, atc_users: r.atc_users * ydayCut, first_purchasers: r.first_purchasers * ydayCut } : r))) : null;
  const drivers = history.state === "ok" ? campaignDrivers(driverHist, driverAf, { from: period.from, to: period.to }, { from: period.cmpFrom, to: period.cmpTo }) : [];

  // ---------- 7–9. Creatives and formats ----------
  const points = creatives ? opportunityMap(creatives) : [];
  const basePer100 = creatives?.baseline.purchasers_per_install != null ? Math.round(creatives.baseline.purchasers_per_install * 1000) / 10 : null;
  const formats = creatives ? formatPerformance(creatives).filter((f) => f.spend > 0) : [];
  const cohort = creatives ? octCohort(creatives) : null;

  // ---------- 10. Insights ----------
  const l7 = periods.find((p) => p.id === "last7")!;
  const insights = [
    ...(funnel
      ? freshInsights({ periodLabel: period.label, funnel, cur: curFacts, cmp: cmpFacts, afComparable: period.cmpFrom >= AF_COVERAGE_FROM, metaComparable: period.cmpFrom >= ADWATCH_FROM, drivers, formats })
      : []),
    ...(history.state === "ok" && creatives
      ? metaInsights({
          recent: totals(hist.filter((r) => r.date >= l7.from && r.date <= l7.to)),
          prior: totals(hist.filter((r) => r.date >= l7.cmpFrom && r.date <= l7.cmpTo)),
          afRecent: afWin.get(afWindowId("last7", "cur")) ?? null,
          afPrior: l7.cmpFrom >= AF_COVERAGE_FROM ? (afWin.get(afWindowId("last7", "cmp")) ?? null) : null,
          salesRecent: newSales(ordersRows, l7.from, l7.to),
          salesPrior: newSales(ordersRows, l7.cmpFrom, l7.cmpTo),
          creatives,
          placementAvailable: false,
          cohort,
        })
      : []),
  ].sort((a, b) => a.priority - b.priority || b.weight - a.weight);

  // ---------- Existing detail tables ----------
  const inRange = (from: string, to: string) => hist.filter((r) => r.date >= from && r.date <= to);
  const table = (level: "campaign" | "adset" | "ad") => {
    const prev = new Map(rollupAds(inRange(previous.from, previous.to), level).map((e) => [e.id, e]));
    return rollupAds(inRange(range.from, range.to), level).map((e) => {
      const p = prev.get(e.id);
      const row = withRates(e);
      const cpiPrev = p && p.installs ? p.spend / p.installs : null;
      return {
        ...row,
        spend_change: p && p.spend ? e.spend / p.spend - 1 : null,
        cpi_change: row.cpi !== null && cpiPrev ? (row.cpi as number) / cpiPrev - 1 : null,
        signal: changeSignal(e, p),
      };
    });
  };
  const campaigns = history.state === "ok" ? table("campaign") : [];
  const adsets = history.state === "ok" ? table("adset") : [];
  const adRows = history.state === "ok" ? table("ad") : [];
  const checkRows =
    check.state === "ok"
      ? check.data.map((r) => ({ ...r, diff: r.adwatch_spend !== null && r.campaign_table_spend !== null ? r.adwatch_spend - r.campaign_table_spend : null }))
      : [];
  const creativeRows = (creatives?.creatives ?? []).map(({ newThisMonth: isNew, ...c }) => ({ ...c, class: CLASS_LABEL[c.cls], cohortLabel: COHORT_LABEL[c.cohort], isNew: isNew ? 1 : 0 }));
  const octRows = creativeRows.filter((c) => c.cohort === "oct");
  const cohortRows = cohort ? [cohort.overall, ...cohort.byFormat, cohort.preOct].map((g) => ({ ...g })) : [];
  const cohortChart = cohort
    ? cohort.byFormat.map((g) => ({ label: g.group, winners: g.winners, emerging: g.emerging, struggling: g.struggling, too_early: g.live - g.judged, other: g.judged - g.winners - g.emerging - g.struggling }))
    : [];

  const href = (id: string) => {
    const q = new URLSearchParams();
    if (typeof sp.from === "string") q.set("from", sp.from);
    if (typeof sp.to === "string") q.set("to", sp.to);
    q.set("period", id);
    return `/meta-ads?${q.toString()}`;
  };
  const fresh = freshness.state === "ok" ? freshness.data.filter((r) => ["meta_ad_daily", "af_events", "af_ad_daily", "crm_cart_leads", "orders"].includes(r.source)) : [];
  const FRESH_LABEL: Record<string, string> = { meta_ad_daily: "Meta", af_events: "AppsFlyer", af_ad_daily: "AppsFlyer by ad", crm_cart_leads: "CRM leads", orders: "Orders" };
  const cmpShort = period.id === "mtd" ? "vs prev MTD" : period.id === "last7" ? "vs prior 7d" : period.id === "range" ? "vs prev period" : "vs day before";

  return (
    <div className="theme-white space-y-6">
      {/* ---------- Header ---------- */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Meta Ads Performance → New Sales</h1>
          <p className="mt-1 text-sm text-ink-2">From spend to Fresh Add to Cart to Fresh orders. Meta has no purchase tracking: nothing here is Meta-attributed purchases or ROAS.</p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
            <span className="font-semibold text-ink">Data as of:</span>
            {fresh.map((r) => (
              <span key={r.source}>
                {FRESH_LABEL[r.source]} <span className={cn("tabular-nums font-medium", r.latest_data_date && r.latest_data_date >= last ? "text-good" : "text-critical")}>{r.latest_data_date ? formatDateShort(r.latest_data_date) : "—"}</span>
              </span>
            ))}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className="tabular rounded-md border border-line px-2 py-1 text-xs text-ink">{formatRange(range)} · IST</span>
          <nav aria-label="Period" className="flex flex-wrap gap-1">
            {periods.map((p) => (
              <Link
                key={p.id}
                href={href(p.id)}
                aria-current={p.id === period.id ? "page" : undefined}
                className={cn("rounded-md border px-3 py-1.5 text-xs font-medium", p.id === period.id ? "border-accent bg-accent text-white" : "border-line text-ink hover:bg-surface-2")}
              >
                {p.short}
              </Link>
            ))}
          </nav>
          <span className="text-[11px] text-ink-2">
            {period.label} {period.cmpLabel}
            {period.partial ? " · day in progress" : ""}
          </span>
        </div>
      </header>

      {/* ---------- 1. Key metrics ---------- */}
      <section className="space-y-2">
        <SectionTitle n={1} title={`Key metrics · ${period.label}`} sub={`${period.cmpLabel} · hover a tile for its definition`} />
        <KpiStrip tiles={tiles} cmpLabel={cmpShort} />
      </section>

      {/* ---------- 2. Key metrics by period ---------- */}
      <ChartCard
        title={`2 · Key metrics — now vs the same time yesterday, last 7 days and MTD (to ${hhmm})`}
        question={`Every column up to MTD is counted to ${hhmm} IST on its own days (Last 7 days and MTD = average per day), and under each one: how now compares with it. The selected range keeps its own comparison with the previous period.`}
        result={history}
        footnote={`Orders, AppsFlyer and CRM leads are cut at ${hhmm} exactly. Meta has no readable hourly data: today's Meta figures run to the last adwatch pull (${metaTo}); earlier days to that time = full day × the usual hourly spend shape, so their Meta rates (CPM, CTR, CPC, CPI) are full-day rates. Fresh Add to Carts come from AppsFlyer, whose first whole day is ${formatDate(AF_FIRST_FULL_DAY)}: MTD averages AppsFlyer measures from then. CAC uses distinct Fresh customers per day. Green = better, red = worse.`}
      >
        <PeriodMatrix windows={matrixCols} rows={kpiRows} />
      </ChartCard>

      {/* ---------- 3. Timeline ---------- */}
      <ChartCard
        title="3 · Performance trend with key events"
        question={`Daily spend, CPI, Fresh Add to Carts and New Sales, ${formatDate(range.from)} – ${formatDate(range.to)}. Click a series to hide it.`}
        result={history}
        footnote={`Three axes: spend (left, ₹), CPI (right, red, ₹; days with ≥ 5 installs), Fresh Add to Carts and New Sales (far right, green, counts). Fresh Add to Carts start ${formatDate(AF_COVERAGE_FROM)} (AppsFlyer coverage). New Sales = all eligible Fresh orders, APP + WEB, not attributed to Meta. Events are verified from delivery data: a campaign's first / last day with spend (≥ 1% of spend), October creatives' first delivery (≥ 2% of spend) and spend shifts ≥ 35% vs the trailing 7-day average. Budget edits are not shown: no readable source records them (the Meta activity log stopped loading on 7 Jul 2026).`}
      >
        <PerformanceTimeline data={timelineData} events={events} />
      </ChartCard>

      {/* ---------- 4. Funnel by period ---------- */}
      <ChartCard
        title={`4 · Funnel: Meta → Fresh orders — now vs the same time yesterday, last 7 days and MTD (to ${hhmm})`}
        question={`The same five steps for every column, with step conversion. Columns up to MTD are counted to ${hhmm} on their own days (per-day averages); the selected range keeps its own comparison. AppsFlyer-covered days only.`}
        result={af}
        footnote={`Impressions, link clicks and installs = Meta-reported. Fresh Add to Carts = Meta-attributed AppsFlyer users whose first add-to-cart came before any COMPLETED order. Last step = those users who placed an eligible Fresh order (AppsFlyer customer match to actual orders, not Meta attribution). Windows that start before ${formatDate(AF_COVERAGE_FROM)} are cut to start on that day, for Meta steps too. Counts are compared only when the comparison covers the same number of days; conversion rates are always compared.`}
      >
        <PeriodMatrix windows={matrixCols} rows={funnelRows} />
      </ChartCard>

      {/* ---------- 5–7 ---------- */}
      <div className="grid gap-4 xl:grid-cols-[5fr_4fr_4fr]">
        <ChartCard
          className="min-w-0"
          title={`5 · Funnel detail · ${period.short}`}
          question={funnel ? `${spanLabel(funnel.window.from, funnel.window.to)}${funnel.cmpWindow ? ` vs ${spanLabel(funnel.cmpWindow.from, funnel.cmpWindow.to)}` : ""} · AppsFlyer-covered days only` : "No AppsFlyer data for this period."}
          result={af}
          footnote="Bar widths are on a log scale. Meta = Meta-reported. Fresh Add to Carts = Meta-attributed AppsFlyer USERS whose first add-to-cart came before any COMPLETED order. Last step = those users who placed an eligible Fresh order (AppsFlyer customer match to actual orders, not Meta attribution). Checkout, all Meta-user orders, leads and all New Sales are shown underneath, not as steps: checkout is skipped by WEB-assisted orders, and the others are different populations."
        >
          {funnel ? <FreshFunnel view={funnel} /> : <p className="text-sm text-ink-2">AppsFlyer coverage starts {formatDate(AF_COVERAGE_FROM)}.</p>}
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="6 · Where are we losing Fresh users?"
          question="Change in drop-off rate vs the comparison window, per step (red = losing more)."
          result={af}
          footnote="Rates compare the AppsFlyer-covered days of each window, so windows of different length stay comparable."
        >
          {funnel ? <DropOffBars view={funnel} /> : null}
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="7 · Channel efficiency (Fresh users)"
          question={`Cost per outcome · ${period.label} ${period.cmpLabel}`}
          footnote="All costs use Meta spend. Cost per Fresh ATC and per Meta-user Fresh order use spend on AppsFlyer-covered days only. Cost per Fresh Lead uses CRM leads from all sources. CAC = Meta spend ÷ all distinct Fresh customers (blended). Red = more expensive."
        >
          <EfficiencyBars rows={eff} curLabel="Current" prevLabel="Comparison" />
        </ChartCard>
      </div>

      {/* ---------- 8–9 ---------- */}
      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <ChartCard
          className="min-w-0"
          title="8 · Top campaigns driving change"
          question={`${period.label} ${period.cmpLabel}, sorted by size of the spend change.${period.cmpFrom < ADWATCH_FROM ? " The comparison starts before Meta data (12 Sep), so Δ spend overstates growth." : ""}`}
          result={history}
          footnote={`${afCampaigns.state === "ok" || afCampaigns.state === "empty" ? "" : "AppsFlyer campaign report is not readable by the dashboard yet (no SELECT grant on adwatch.af_campaign_daily), so add-to-cart, first-purchaser and CAC columns are hidden. "}Spend and CPI from Meta. Add-to-cart users and first purchasers from AppsFlyer's campaign report (all customers; no Fresh split by campaign). CAC here = spend ÷ AppsFlyer first purchasers — AppsFlyer attribution, not Fresh orders and not Meta purchases.`}
        >
          <DataTable columns={afCampaigns.state === "ok" || afCampaigns.state === "empty" ? DRIVER_COLUMNS : DRIVER_COLUMNS.filter((c) => !c.key.startsWith("af_") && !c.key.startsWith("cost_per_af") && c.key !== "cac_change")} rows={drivers.map((d) => ({ ...d }))} pageSize={8} searchable={false} exportName={`meta-campaign-drivers-${period.from}-${period.to}`} />
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="9 · Creative opportunity map"
          question={`CPI vs AppsFlyer purchasers per 100 installs; bubble = spend. ${spanLabel(window.from, window.to)}.`}
          result={history}
          footnote="Meta reports no add-to-cart or purchase by creative, and AppsFlyer's Meta add-to-cart is account-level only, so cost per Fresh ATC cannot be split by creative. Purchase evidence = AppsFlyer purchasers matched by ad name (all purchasers). Dashed lines = account CPI and account purchasers per 100 installs. Groups use the existing creative rules (≥ 10 installs to judge)."
        >
          <OpportunityMap points={points} baselineCpi={creatives?.baseline.cpi ?? null} baselinePer100={basePer100} />
        </ChartCard>
      </div>

      {/* ---------- 10–12 ---------- */}
      <div className="grid gap-4 2xl:grid-cols-[1fr_2fr]">
        <ChartCard className="min-w-0"
          title="10 · Placement analysis" question="Which placements are efficient for Fresh users?">
          <p className="text-sm text-ink">Not available — no figures are shown rather than estimated.</p>
          <p className="mt-2 text-xs text-ink-2">
            The only placement breakdown (<code className="break-all">Meta_AdSpent.ads_insights_platform_and_device</code>) stopped loading on 14 Jul 2026, and adwatch collects
            ad-level data without placement. To enable this section, add the <code>publisher_platform</code> / <code>platform_position</code> breakdown to the
            adwatch Meta collector.
          </p>
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="11 · Creative format performance"
          question={`Static vs video vs UGC · ${spanLabel(window.from, window.to)}`}
          result={history}
          footnote="UGC = ad or list name contains “UGC”. Brand video / Static image come from the October creative list; other ads are inferred from 3-second video views. Purchasers = AppsFlyer by ad name (all purchasers, not Fresh only)."
        >
          <DataTable columns={FORMAT_COLUMNS} rows={formats.map((f) => ({ ...f }))} searchable={false} />
        </ChartCard>
      </div>
      <ChartCard title="12 · Insights & next actions" question="Ranked by priority. Expand an item for evidence, cause, impact on New Sales, action and how to measure it.">
        <InsightPanel insights={insights} limit={10} />
      </ChartCard>

      {!afOk ? <p className="text-xs text-critical">AppsFlyer data could not be loaded: Fresh Add to Cart figures are unavailable.</p> : null}

      {/* ---------- Detail (existing) ---------- */}
      <div className="grid gap-4">
        <ChartCard
          className="min-w-0"
          title="October creatives: winning rate"
          question="How many October launches became winners, by format?"
          result={history}
          footnote="Winning rate = proven winners ÷ October creatives with enough data to judge (≥ 10 installs and meaningful spend). Pre-October creatives are context only. Flexible / multi-creative ads are excluded."
        >
          {cohort ? (
            <p className="mb-3 text-xs text-ink-2">
              {cohort.liveOnMeta} of {cohort.listed} listed October creatives have delivered on Meta in this window; winning rate{" "}
              <strong className="text-ink">{cohort.overall.winRate !== null ? `${Math.round(cohort.overall.winRate * 100)}%` : "—"}</strong> ({cohort.overall.winners} of {cohort.overall.judged} judged).
            </p>
          ) : null}
          <CategoryBars
            data={cohortChart}
            categoryKey="label"
            series={[
              { key: "winners", label: "Proven winners", color: "web_other" },
              { key: "emerging", label: "Emerging", color: "app" },
              { key: "other", label: "Steady", color: "neutral" },
              { key: "struggling", label: "Struggling", color: "web_agent" },
              { key: "too_early", label: "Too early", color: "tier_5" },
            ]}
            format="count"
            orientation="horizontal"
            stacked
          />
          <div className="mt-3">
            <DataTable columns={COHORT_COLUMNS} rows={cohortRows} searchable={false} />
          </div>
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="October creatives — detail and mapping"
          question="Which October launches are working, and how each list name maps to Meta ads."
          result={history}
          footnote={cohort && cohort.notLive.length ? `Not delivered on Meta in this window (${cohort.notLive.length}): ${cohort.notLive.join(", ")}.` : undefined}
        >
          <DataTable columns={OCT_COLUMNS} rows={octRows} pageSize={10} exportName={`meta-october-creatives-${window.from}-${window.to}`} />
        </ChartCard>
      </div>

      <ChartCard title="All creatives — assessment" question={`Window ${formatDate(window.from)} – ${formatDate(window.to)}; account CPI ${creatives?.baseline.cpi ? formatMetric(creatives.baseline.cpi, "inr_precise") : "—"}.`} result={history}>
        <DataTable columns={CREATIVE_COLUMNS} rows={creativeRows} pageSize={10} exportName={`meta-creatives-${window.from}-${window.to}`} />
      </ChartCard>

      <ChartCard title="Campaigns" question="Selected date range vs the previous period of the same length." result={history}>
        <DataTable columns={ENTITY_COLUMNS("Campaign")} rows={campaigns} exportName={`meta-campaigns-${range.from}-${range.to}`} />
      </ChartCard>
      <ChartCard title="Ad sets" result={history}>
        <DataTable columns={ENTITY_COLUMNS("Ad set", "Campaign")} rows={adsets} exportName={`meta-adsets-${range.from}-${range.to}`} />
      </ChartCard>
      <ChartCard title="Ads" result={history}>
        <DataTable columns={ENTITY_COLUMNS("Ad", "Ad set")} rows={adRows} exportName={`meta-ads-${range.from}-${range.to}`} />
      </ChartCard>

      <ChartCard
        title="Spend reconciliation"
        question="Does ad-level spend agree with the campaign table?"
        result={check}
        footnote="Small differences on the most recent days are Meta late restatements. A persistent gap is a data-quality issue."
      >
        <DataTable columns={CHECK_COLUMNS} rows={checkRows} searchable={false} />
      </ChartCard>

      <SourceNotes sources={["meta_ad_daily", "meta_campaign_check", "af_events", "af_ad_daily", "crm_cart_leads", "orders"]} />
    </div>
  );
}
