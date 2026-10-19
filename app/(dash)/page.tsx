import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { getCartLeadsDaily } from "@/lib/data/cartLeads";
import { loadGrowthContext } from "@/lib/data/growth";
import { acquisitionCosts, summarizeCartLeads, summarizeFresh, summarizeMeta, uniqueFreshCustomers } from "@/lib/metrics/compute";
import { freshByChannelDaily, metaDaily } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";
import type { DataResult } from "@/lib/types/result";

export const metadata: Metadata = { title: "Overview" };

function combinedState(...rs: DataResult<unknown>[]): DataResult<unknown>["state"] {
  if (rs.some((r) => r.state === "error")) return "error";
  if (rs.some((r) => r.state === "not_connected")) return "not_connected";
  if (rs.some((r) => r.state === "empty")) return "empty";
  return "ok";
}

const DAILY_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "spend", label: "Meta spend", format: "inr" },
  { key: "installs", label: "Installs (Meta)", format: "count" },
  { key: "app", label: "Fresh APP", format: "count" },
  { key: "web", label: "Fresh WEB", format: "count" },
  { key: "fresh_total", label: "Fresh orders", format: "count" },
  { key: "cac", label: "CAC / Fresh order", format: "inr" },
  { key: "fresh_revenue", label: "Fresh revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr" },
];

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);

  // One shared loader for New Sales, customers, Meta spend, funnels and insights, so Overview and App Funnel agree.
  const [ctx, leads] = await Promise.all([loadGrowthContext(range, previous), getCartLeadsDaily(range)]);
  const { meta, orders, uniq, metaPrev, ordersPrev, uniqPrev } = ctx;

  const m = meta.state === "ok" ? summarizeMeta(meta.data) : null;
  const mp = metaPrev.state === "ok" ? summarizeMeta(metaPrev.data) : null;
  const f = orders.state === "ok" ? summarizeFresh(orders.data) : null;
  const fp = ordersPrev.state === "ok" ? summarizeFresh(ordersPrev.data) : null;
  const u = uniq.state === "ok" ? uniqueFreshCustomers(uniq.data) : null;
  const up = uniqPrev.state === "ok" ? uniqueFreshCustomers(uniqPrev.data) : null;
  const l = leads.state === "ok" ? summarizeCartLeads(leads.data) : null;
  const acq = acquisitionCosts(m?.spend ?? null, f?.fresh_orders ?? null, u);
  const acqPrev = acquisitionCosts(mp?.spend ?? null, fp?.fresh_orders ?? null, up);

  const acqState = combinedState(meta, orders);
  const custState = combinedState(meta, uniq);

  const ordersDaily = orders.state === "ok" ? freshByChannelDaily(orders.data, range.from, range.to) : [];
  const spendDaily = meta.state === "ok" ? metaDaily(meta.data, range.from, range.to) : [];
  const spendByDate = new Map(spendDaily.map((r) => [r.date, r]));
  const dailyTable =
    orders.state === "ok" && meta.state === "ok"
      ? ordersDaily.map((r) => {
          const s = spendByDate.get(r.date as string);
          const spend = (s?.spend as number | null) ?? null;
          const total = r.fresh_total as number;
          return { ...r, spend, installs: s?.installs ?? null, cac: spend !== null && total ? spend / total : null };
        })
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Executive growth overview"
        description="New Sales (unique eligible Fresh orders), distinct Fresh customers and Meta acquisition cost, across self-serve APP and sales-assisted WEB orders."
        range={range}
        sources={["meta_ad_daily", "orders", "crm_cart_leads"]}
      />

      <KpiGrid>
        <KpiCard metric="spend" state={meta.state} value={m?.spend} previous={mp?.spend} />
        <KpiCard metric="installs_meta" state={meta.state} value={m?.installs} previous={mp?.installs} />
        <KpiCard metric="cpi" state={meta.state} value={m?.cpi} previous={mp?.cpi} />
        <KpiCard metric="cart_leads_fresh" state={leads.state} value={l?.fresh} />
        <KpiCard metric="cac_fresh_order" state={acqState} value={acq.cac_fresh_order} previous={acqPrev.cac_fresh_order} />
        <KpiCard metric="cost_per_new_customer" state={custState} value={acq.cost_per_new_customer} previous={acqPrev.cost_per_new_customer} />
        <KpiCard metric="fresh_orders" state={orders.state} value={f?.fresh_orders} previous={fp?.fresh_orders} />
        <KpiCard metric="fresh_app" state={orders.state} value={f?.fresh_app} previous={fp?.fresh_app} />
        <KpiCard metric="fresh_web" state={orders.state} value={f?.fresh_web} previous={fp?.fresh_web} />
        <KpiCard metric="unique_new_customers" state={uniq.state} value={u} previous={up} />
        <KpiCard metric="fresh_revenue" state={orders.state} value={f?.fresh_revenue} previous={fp?.fresh_revenue} />
        <KpiCard metric="aov_fresh" state={orders.state} value={f?.aov_fresh} previous={fp?.aov_fresh} />
      </KpiGrid>

      <Callout>
        <strong>Definitions.</strong> New Sales = unique eligible Fresh orders (Order_Type = Fresh, excluding PRESCRIPTION_UPLOADED,
        DELIVERY_CANCELED and THREE_PL_CANCELLED_ACKNOWLEDGEMENT). Fresh customers = distinct userIDs with an eligible Fresh order, de-duplicated
        across APP and WEB. AOV = Fresh revenue ÷ New Sales. CAC per Fresh order = Meta spend (all campaigns in the ad account) ÷ New Sales
        (APP + WEB); CAC per Fresh customer = the same spend ÷ distinct Fresh customers.
      </Callout>

      <ChartCard title="What needs attention" question="Ranked by business impact and urgency. Expand an item for evidence, causes, action and impact.">
        <InsightPanel insights={ctx.insights} limit={5} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Fresh orders by channel" question="Are new sales coming from self-serve or sales-assisted orders?" result={orders}>
          <TrendChart
            data={ordersDaily}
            xKey="date"
            format="count"
            kind="bar"
            stacked
            series={[
              { key: "app", label: "APP (self-serve)", color: "app" },
              { key: "web", label: "WEB (sales-assisted)", color: "web" },
            ]}
          />
        </ChartCard>
        <ChartCard title="Daily Meta spend" question="Did spend move with Fresh orders?" result={meta}>
          <TrendChart data={spendDaily} xKey="date" format="inr" series={[{ key: "spend", label: "Meta spend", color: "accent" }]} />
        </ChartCard>
      </div>

      <ChartCard
        title="Daily summary"
        question="Day-by-day spend, Fresh orders and CAC."
        result={combinedState(meta, orders) === "ok" ? undefined : orders.state !== "ok" ? orders : meta}
        footnote="CAC / Fresh order = Meta spend (all campaigns) ÷ eligible Fresh orders (APP + WEB) for that day. Daily rows are not summed into customers; the customer-based CAC is the KPI above. Previous-period deltas compare with the same number of days immediately before."
      >
        <DataTable columns={DAILY_COLUMNS} rows={dailyTable} exportName={`overview-daily-${range.from}-${range.to}`} />
      </ChartCard>

      <Callout>
        Spend scope: CAC uses all Meta spend in the ad account. If CAC should use app-install campaigns only, that is a definition change to
        agree first. Target-vs-actual appears once targets are configured.
      </Callout>

      <SourceNotes sources={["meta_ad_daily", "orders", "crm_cart_leads"]} />
    </div>
  );
}
