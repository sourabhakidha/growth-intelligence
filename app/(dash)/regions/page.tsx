import type { Metadata } from "next";
import { CategoryBars, type CategorySeries } from "@/components/charts/CategoryBars";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart, type TrendSeries } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { getMetaAdDaily } from "@/lib/data/metaAds";
import { getRegional, getRegionalNewMarkets, getRegionalPeriods } from "@/lib/data/regions";
import { formatCount } from "@/lib/format/inr";
import { formatDate, todayIST } from "@/lib/format/ist";
import { periodSpecs } from "@/lib/format/periods";
import { SUPPRESSED_PINCODES_KEY } from "@/lib/geo/aggregate";
import { TIER_LABEL, WATCH_AREAS, type RegionTier } from "@/lib/geo/regions";
import { buildPeriodView, buildRegionalView, INSIGHT_MIN_ORDERS, type RegionalMetrics } from "@/lib/metrics/regional";
import { buildNewMarketsView, buildRegionalInsights, buildSpendByTargeting } from "@/lib/metrics/regionalInsights";
import { dateSpine } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Regional Analysis" };

// ---------- Columns ----------

const METRIC_COLUMNS: TableColumn[] = [
  { key: "fresh_orders", label: "Fresh orders", format: "count", hint: "Distinct order IDs of eligible Fresh orders." },
  { key: "fresh_app", label: "APP", format: "count", hint: "Self-serve app orders." },
  { key: "fresh_web", label: "WEB", format: "count", hint: "Sales-assisted orders within the app business." },
  { key: "customers", label: "Customers", format: "count", hint: "Distinct Fresh userIDs in this row. Rows overlap, so do not add them up." },
  { key: "revenue", label: "Fresh revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr", hint: "Fresh revenue ÷ Fresh orders of this row." },
];
const OUTCOME_COLUMNS: TableColumn[] = [
  { key: "rto_orders", label: "RTO", format: "count", hint: "Eligible Fresh orders returned to origin (RTO_INITIATED, RTO_IN_TRANSIT, RTO_DELIVERED, RETURN_TO_ORIGIN)." },
  { key: "rto_rate", label: "RTO rate", format: "pct", hint: "RTO ÷ (delivered + RTO). In-transit orders are not counted yet." },
  { key: "cancelled_orders", label: "Cancelled", format: "count", hint: "Placed Fresh orders in DELIVERY_CANCELED or THREE_PL_CANCELLED_ACKNOWLEDGEMENT." },
  { key: "cancel_rate", label: "Cancel rate", format: "pct", hint: "Cancelled ÷ placed Fresh orders." },
];

const PERIOD_COLUMNS: TableColumn[] = [
  { key: "label", label: "Period", format: "text" },
  { key: "fresh_orders", label: "Fresh orders", format: "count" },
  { key: "orders_per_day", label: "Orders / day", format: "count", hint: "Fresh orders ÷ complete days." },
  { key: "fresh_app", label: "APP", format: "count" },
  { key: "fresh_web", label: "WEB", format: "count" },
  { key: "customers", label: "Customers", format: "count" },
  { key: "revenue", label: "Fresh revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr" },
  { key: "rto_rate", label: "RTO rate", format: "pct" },
  { key: "cancel_rate", label: "Cancel rate", format: "pct" },
];

const TIER_COLUMNS: TableColumn[] = [
  { key: "label", label: "Tier", format: "text" },
  ...METRIC_COLUMNS,
  { key: "order_share", label: "Order share", format: "pct" },
  { key: "orders_change", label: "Orders vs prev.", format: "pct" },
  ...OUTCOME_COLUMNS,
];
const MARKET_COLUMNS: TableColumn[] = [
  { key: "label", label: "Market", format: "text" },
  ...METRIC_COLUMNS,
  { key: "order_share", label: "Order share", format: "pct" },
  { key: "rto_rate", label: "RTO rate", format: "pct" },
  { key: "cancel_rate", label: "Cancel rate", format: "pct" },
];
const PINCODE_COLUMNS: TableColumn[] = [{ key: "key", label: "Pincode", format: "text" }, { key: "group", label: "Area", format: "text" }, ...METRIC_COLUMNS, ...OUTCOME_COLUMNS];
const METRO_COLUMNS: TableColumn[] = [
  { key: "rank", label: "#", format: "count" },
  { key: "key", label: "Metro city / area", format: "text" },
  { key: "tier", label: "Tier", format: "text" },
  ...METRIC_COLUMNS,
  { key: "orders_change", label: "Orders vs prev.", format: "pct" },
  ...OUTCOME_COLUMNS,
];
const AREA_COLUMNS: TableColumn[] = [
  { key: "tier", label: "Tier", format: "text" },
  { key: "key", label: "Area", format: "text" },
  ...METRIC_COLUMNS,
  { key: "web_share", label: "WEB share", format: "pct" },
  { key: "orders_change", label: "Orders vs prev.", format: "pct" },
  ...OUTCOME_COLUMNS,
  { key: "note", label: "Note", format: "text" },
];
const SPEND_COLUMNS: TableColumn[] = [
  { key: "label", label: "Location in ad set name", format: "text" },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "share", label: "Share of spend", format: "pct" },
  { key: "share_prev", label: "Share, prev. period", format: "pct" },
  { key: "ad_sets", label: "Ad sets", format: "count" },
  { key: "top_ad_set", label: "Largest ad set", format: "text" },
];
const NEW_TIER_COLUMNS: TableColumn[] = [
  { key: "label", label: "Tier", format: "text" },
  { key: "active_pins", label: "Pincodes ordering", format: "count", hint: "Distinct pincodes with an eligible Fresh order in the range." },
  { key: "new_pins", label: "First-time pincodes", format: "count", hint: "Pincodes whose first-ever eligible Fresh order is in the range (history from 25 Oct 2025)." },
  { key: "new_areas", label: "New areas", format: "count", hint: "Areas (Tier 3: 3-digit postal districts) with their first-ever eligible Fresh order in the range." },
  { key: "orders", label: "Orders from first-time pincodes", format: "count" },
  { key: "new_order_share", label: "Share of tier's orders", format: "pct" },
];
const NEW_AREA_COLUMNS: TableColumn[] = [
  { key: "key", label: "New Tier 3 area", format: "text" },
  { key: "first_date", label: "First order", format: "date" },
  { key: "new_pins", label: "Pincodes", format: "count" },
  { key: "orders", label: "Fresh orders", format: "count" },
];
const WATCH_COLUMNS: TableColumn[] = [{ key: "key", label: "Market", format: "text" }, { key: "note", label: "Why it is flagged", format: "text" }, ...METRIC_COLUMNS, ...OUTCOME_COLUMNS];

// ---------- Chart series ----------

const TIER_COLORS: Record<Exclude<RegionTier, "unverified">, TrendSeries["color"]> = {
  priority_mumbai: "app",
  tier_1: "web_other",
  delhi_ncr: "web_agent",
  tier_2: "tier_4",
  tier_3: "tier_5",
};
const TIER_SERIES: TrendSeries[] = (Object.keys(TIER_COLORS) as (keyof typeof TIER_COLORS)[]).map((t) => ({ key: t, label: TIER_LABEL[t], color: TIER_COLORS[t] }));
const CHANNEL_SERIES: CategorySeries[] = [
  { key: "fresh_app", label: "APP (self-serve)", color: "app" },
  { key: "fresh_web", label: "WEB (sales-assisted)", color: "web" },
];
const OUTCOME_SERIES: CategorySeries[] = [
  { key: "rto_rate", label: "RTO rate", color: "web_agent" },
  { key: "cancel_rate", label: "Cancellation rate", color: "neutral" },
];

const tierLabel = (g: string) => TIER_LABEL[g as RegionTier] ?? g;
const row = (m: RegionalMetrics, extra: Record<string, string | number | null> = {}) => ({ ...m, ...extra });
const chartRow = (label: string, m: RegionalMetrics) => ({
  label,
  fresh_app: m.fresh_app,
  fresh_web: m.fresh_web,
  rto_rate: m.rto_rate,
  cancel_rate: m.cancel_rate,
});

export default async function RegionsPage({ searchParams }: PageProps<"/regions">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const today = todayIST();
  const specs = periodSpecs(range.to, today);
  const [cur, prev, per, fresh, spendCur, spendPrev] = await Promise.all([
    getRegional(range),
    getRegional(previous),
    getRegionalPeriods(range.to, today),
    getRegionalNewMarkets(range),
    getMetaAdDaily(range),
    getMetaAdDaily(previous),
  ]);
  const tierPeriodColumns: TableColumn[] = [{ key: "tier", label: "Tier", format: "text" }, ...specs.map((p) => ({ key: p.id, label: p.label, format: "count" as const }))];

  const dates = dateSpine(range.from, range.to);
  const view = cur.state === "ok" ? buildRegionalView(cur.data, prev.state === "ok" ? prev.data : null, dates) : null;
  const prevView = prev.state === "ok" ? buildRegionalView(prev.data, null, dateSpine(previous.from, previous.to)) : null;
  const spend = spendCur.state === "ok" ? buildSpendByTargeting(spendCur.data, spendPrev.state === "ok" ? spendPrev.data : null) : null;
  const newMarkets = fresh.state === "ok" && view ? buildNewMarketsView(fresh.data, dates, view.tiers) : null;
  const regionalInsights = view
    ? buildRegionalInsights({
        tiers: view.tiers,
        prevTiers: prevView?.tiers ?? null,
        daily: view.daily,
        spend,
        metaConnected: spendCur.state === "ok" || spendCur.state === "empty",
        newMarkets,
        days: dates.length,
      })
    : [];
  const prevShareOf = (t: RegionTier) => (prevView ? (prevView.tiers.find((x) => x.group === t)?.order_share ?? 0) : null);
  const mumbaiSpend = spend?.find((r) => r.group === "mumbai");
  const t3New = newMarkets?.byTier.find((r) => r.group === "tier_3");
  const periods = per.state === "ok" ? buildPeriodView(per.data, specs) : null;
  const total = view?.total ?? null;
  const tierShare = (t: RegionTier) => view?.tiers.find((x) => x.group === t)?.order_share ?? null;
  const priorityApp = view?.tiers.find((t) => t.group === "priority_mumbai")?.fresh_app ?? 0;
  const priorityAppShare = total && total.fresh_app ? priorityApp / total.fresh_app : null;
  const mumbaiShare = view ? (view.markets.find((x) => x.group === "mumbai")?.order_share ?? 0) : null;
  const tiersForCharts = (view?.tiers ?? []).filter((t) => t.group !== "unverified");
  const topPincodes = (view?.pincodes ?? []).filter((p) => p.key !== SUPPRESSED_PINCODES_KEY).slice(0, 15);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Regional analysis"
        description="Fresh orders by pincode: Priority Mumbai pincodes, Tier 1, Delhi NCR, Tier 2 and Tier 3 markets, with self-serve APP vs sales-assisted WEB, RTO and cancellations."
        range={range}
        sources={["regions", "orders", "meta_ad_daily"]}
      />

      {view && view.watch.length ? (
        <Callout tone="warning">
          Orders from markets we do not target:{" "}
          {view.watch.map((w, i) => (
            <span key={w.key}>
              {i ? "; " : ""}
              <strong>{w.key}</strong> {formatCount(w.fresh_orders)} Fresh order{w.fresh_orders === 1 ? "" : "s"} ({w.note.toLowerCase()})
            </span>
          ))}
          .
        </Callout>
      ) : null}

      {/* ---------- Priority Mumbai vs spend: insights ---------- */}
      <KpiGrid cols={5}>
        <KpiCard metric="priority_mumbai_share" state={cur.state} value={tierShare("priority_mumbai")} previous={prevShareOf("priority_mumbai")} />
        <KpiCard metric="priority_app_share" state={cur.state} value={priorityAppShare} />
        <KpiCard metric="tier3_share" state={cur.state} value={tierShare("tier_3")} previous={prevShareOf("tier_3")} />
        <KpiCard metric="mumbai_spend_share" state={spendCur.state} value={mumbaiSpend?.share} previous={mumbaiSpend?.share_prev} />
        <KpiCard
          metric="tier3_new_pins_per_day"
          state={fresh.state}
          value={t3New?.pins_per_day}
          sublabel={t3New ? `${formatCount(t3New.new_pins)} new pincodes, ${formatCount(t3New.new_areas)} new districts` : undefined}
        />
      </KpiGrid>

      <ChartCard
        title="Priority Mumbai vs spend: insights"
        question="Is spend going where we want new sales (Priority Mumbai pincodes), and what is Tier 3 growth bringing?"
        result={cur}
        footnote="Rule-based. Spend is grouped by the location written in the ad set / campaign name: the intended audience, not measured delivery (Meta does not report spend by pincode). Meta drives self-serve APP orders, so spend is compared with APP orders. New = first-ever eligible Fresh order at that pincode / area since order history starts (25 Oct 2025)."
      >
        <InsightPanel insights={regionalInsights} />
      </ChartCard>

      <div className="grid gap-4">
        <ChartCard
          title="Meta spend by location in the ad set name"
          question="How much of the budget is aimed at Mumbai?"
          result={spendCur}
          footnote="Mum / Mumbai = Mumbai; Metro / T1 = Metros; MH / Marathi = Maharashtra-wide. Ad sets with no location in their name (creative tests, net-new-customer, retargeting) can deliver anywhere the account targets."
        >
          <DataTable columns={SPEND_COLUMNS} rows={(spend ?? []).map((r) => ({ ...r }))} searchable={false} exportName={`spend-by-targeting-${range.from}-${range.to}`} />
        </ChartCard>
        <ChartCard title="First-time pincodes by tier" question="Is the order base growing in depth (Mumbai) or in breadth (Tier 3)?" result={fresh}>
          <DataTable columns={NEW_TIER_COLUMNS} rows={(newMarkets?.byTier ?? []).map((r) => ({ ...r }))} searchable={false} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard title="New pincodes per day, by tier" question="How many pincodes place their first-ever Fresh order each day?" result={fresh}>
          <TrendChart data={newMarkets?.dailyPins ?? []} xKey="date" format="count" kind="bar" stacked series={TIER_SERIES} />
        </ChartCard>
        <ChartCard title="New Tier 3 areas this period" question="Which Tier 3 districts started ordering?" result={fresh} footnote="Area = 3-digit postal district, named after its most common city.">
          <DataTable columns={NEW_AREA_COLUMNS} rows={(newMarkets?.newTier3Areas ?? []).map((r) => ({ ...r }))} pageSize={10} exportName={`new-tier3-areas-${range.from}-${range.to}`} />
        </ChartCard>
      </div>

      {/* ---------- Today / yesterday / last 7 days / MTD (independent of the date filter) ---------- */}
      <ChartCard
        title={`Day vs previous day vs last 7 days vs month to date — as of ${formatDate(range.to)}`}
        question="Follows the end date of the date filter. When the end date is today, today is shown so far and the 7-day and month-to-date figures use complete days only."
        result={per}
        footnote="Orders / day = Fresh orders ÷ complete days, so periods of different length can be compared. Each period shows its exact dates."
      >
        <DataTable columns={PERIOD_COLUMNS} rows={(periods?.overall ?? []).map((p) => ({ ...p }))} searchable={false} />
      </ChartCard>

      <div className="grid gap-4">
        <ChartCard title="Average Fresh orders per day, by tier" question="Is the latest day running ahead of or behind the weekly and monthly pace?" result={per}>
          <CategoryBars data={periods?.perDayByTier ?? []} categoryKey="period" series={TIER_SERIES} format="count" stacked />
        </ChartCard>
        <ChartCard title="Fresh orders by tier and period" result={per}>
          <DataTable columns={tierPeriodColumns} rows={periods?.tierOrders ?? []} searchable={false} />
        </ChartCard>
      </div>

      {/* ---------- Selected date range ---------- */}
      <Callout>
        Below: the selected date range. Each order counts in exactly one group: Priority Mumbai pincodes → Tier 1 (rest of MMR, Pune, Kolkata,
        Hyderabad, Ahmedabad, Chennai, Bangalore, Surat) → Delhi NCR → Tier 2 (established Tier 2 cities) → Tier 3 (smaller cities, peripheral
        markets and outlier pockets). Orders and revenue add up across groups; customer counts do not, because a customer can order to more
        than one location.
      </Callout>

      <KpiGrid cols={4}>
        <KpiCard metric="fresh_orders" state={cur.state} value={total?.fresh_orders} previous={total?.orders_prev} />
        <KpiCard metric="unique_new_customers" state={cur.state} value={total?.customers} />
        <KpiCard metric="fresh_revenue" state={cur.state} value={total?.revenue} />
        <KpiCard metric="aov_fresh" state={cur.state} value={total?.aov} />
        <KpiCard metric="rto_rate" state={cur.state} value={total?.rto_rate} />
        <KpiCard metric="cancellation_rate" state={cur.state} value={total?.cancel_rate} />
        <KpiCard metric="priority_mumbai_share" state={cur.state} value={tierShare("priority_mumbai")} />
        <KpiCard metric="mumbai_share" state={cur.state} value={mumbaiShare} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Fresh orders by tier" question="Which tiers drive new sales, and how much is self-serve vs sales-assisted?" result={cur}>
          <CategoryBars data={tiersForCharts.map((t) => chartRow(tierLabel(t.group), t))} categoryKey="label" series={CHANNEL_SERIES} format="count" orientation="horizontal" stacked />
        </ChartCard>
        <ChartCard
          title="RTO and cancellation rate by tier"
          question="Where do orders fail after they are placed?"
          result={cur}
          footnote="RTO rate = RTO ÷ (delivered + RTO). Cancellation rate = cancelled (DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT) ÷ placed Fresh orders."
        >
          <CategoryBars data={tiersForCharts.map((t) => chartRow(tierLabel(t.group), t))} categoryKey="label" series={OUTCOME_SERIES} format="pct" orientation="horizontal" />
        </ChartCard>
      </div>

      <ChartCard
        title="Regional tiers"
        question="Tier detail, with the change vs the previous period of the same length."
        result={cur}
        footnote={
          view && view.unverifiedOrders > 0
            ? `${formatCount(view.unverifiedOrders)} order(s) have no valid pincode and are counted as "location not verified", never as Tier 3.`
            : "Every order in this period has a verified pincode."
        }
      >
        <DataTable columns={TIER_COLUMNS} rows={(view?.tiers ?? []).map((t) => row(t, { label: tierLabel(t.group) }))} searchable={false} exportName={`regional-tiers-${range.from}-${range.to}`} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard title="Daily Fresh orders by tier" question="How is each tier trending day by day?" result={cur}>
          <TrendChart data={view?.daily ?? []} xKey="date" format="count" kind="bar" stacked series={TIER_SERIES} />
        </ChartCard>
        <ChartCard
          title="Mumbai vs other metros vs smaller markets"
          result={cur}
          footnote="Mumbai = Priority Mumbai pincodes + the rest of MMR (Tier 1). Other metros = the other Tier 1 cities + Delhi NCR. Tier 2 cities. Smaller regional markets = Tier 3."
        >
          <CategoryBars
            data={(view?.markets ?? []).filter((x) => x.group !== "unverified").map((x) => chartRow(x.key, x))}
            categoryKey="label"
            series={CHANNEL_SERIES}
            format="count"
            orientation="horizontal"
            stacked
          />
        </ChartCard>
      </div>

      <ChartCard title="Markets — detail" result={cur}>
        <DataTable columns={MARKET_COLUMNS} rows={(view?.markets ?? []).map((x) => row(x, { label: x.key }))} searchable={false} />
      </ChartCard>

      <div className="grid gap-4">
        <ChartCard title="Top 10 metro cities" question="Which metro cities and areas bring the most eligible Fresh orders?" result={cur}>
          <CategoryBars data={(view?.topMetros ?? []).map((x) => chartRow(x.key, x))} categoryKey="label" series={CHANNEL_SERIES} format="count" orientation="horizontal" stacked />
        </ChartCard>
        <ChartCard
          title="Top 10 metro cities — detail"
          result={cur}
          footnote="Metro cities are the Tier 1 cities (including priority Mumbai pincodes) and Delhi NCR; Mumbai-region areas are kept separate (e.g. Thane, Navi Mumbai, Mira-Bhayandar)."
        >
          <DataTable
            columns={METRO_COLUMNS}
            rows={(view?.topMetros ?? []).map((x, i) => row(x, { rank: i + 1, tier: tierLabel(x.group) }))}
            searchable={false}
            exportName={`top-metros-${range.from}-${range.to}`}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4">
        <ChartCard title="Top priority Mumbai pincodes" question="Which priority pincodes drive Fresh orders?" result={cur}>
          <CategoryBars data={topPincodes.map((x) => chartRow(`${x.key} · ${x.group}`, x))} categoryKey="label" series={CHANNEL_SERIES} format="count" orientation="horizontal" stacked />
        </ChartCard>
        <ChartCard title="Priority Mumbai pincodes — detail" result={cur} footnote="Pincodes with fewer than 3 distinct customers are combined into one row to protect customer privacy.">
          <DataTable columns={PINCODE_COLUMNS} rows={(view?.pincodes ?? []).map((x) => row(x))} pageSize={15} exportName={`priority-pincodes-${range.from}-${range.to}`} />
        </ChartCard>
      </div>

      <ChartCard
        title="Outliers and insights"
        question="What stands out this period?"
        result={cur}
        footnote={`Rule-based: areas with at least ${INSIGHT_MIN_ORDERS} orders (or resolved shipments) whose AOV differs from the overall AOV by 30% or more, whose orders moved 30% or more vs the previous period, whose WEB share differs by 15 points or more, or whose RTO / cancellation rate is 10 points or more above the overall rate. Watch markets are always listed.`}
      >
        {view && view.insights.length ? (
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
            {view.insights.map((x) => (
              <li key={x.text}>{x.text}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No area crossed the outlier thresholds in this period.</p>
        )}
      </ChartCard>

      {view && view.watch.length ? (
        <ChartCard title="Watch markets" question="Orders from markets we do not target." result={cur}>
          <DataTable columns={WATCH_COLUMNS} rows={view.watch.map((x) => row(x))} searchable={false} />
        </ChartCard>
      ) : null}

      <ChartCard title="All areas" question="Area-level detail for every tier." result={cur}>
        <DataTable
          columns={AREA_COLUMNS}
          rows={(view?.areas ?? []).map((x) => row(x, { tier: tierLabel(x.group), note: WATCH_AREAS[x.key] ?? null }))}
          pageSize={20}
          exportName={`regional-areas-${range.from}-${range.to}`}
        />
      </ChartCard>

      <SourceNotes sources={["regions", "orders", "meta_ad_daily"]} />
    </div>
  );
}
