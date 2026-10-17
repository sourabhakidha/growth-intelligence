import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { FunnelBars } from "@/components/charts/FunnelBars";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getRegionsDaily, getUnmappedCities } from "@/lib/data/regions";
import { summarizeRegions } from "@/lib/metrics/compute";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Regional Analysis" };

const REGION_COLUMNS: TableColumn[] = [
  { key: "region", label: "Region", format: "text" },
  { key: "fresh_orders", label: "Fresh orders", format: "count" },
  { key: "fresh_app", label: "APP", format: "count" },
  { key: "fresh_web_agent", label: "WEB agent", format: "count" },
  { key: "fresh_web_other", label: "WEB other", format: "count" },
  { key: "order_share", label: "Order share", format: "pct" },
  { key: "fresh_revenue", label: "Revenue", format: "inr" },
  { key: "revenue_share", label: "Revenue share", format: "pct" },
  { key: "aov", label: "AOV", format: "inr" },
];

const UNMAPPED_COLUMNS: TableColumn[] = [
  { key: "city_key", label: "City (as entered)", format: "text" },
  { key: "fresh_orders", label: "Fresh orders", format: "count" },
];

export default async function RegionsPage({ searchParams }: PageProps<"/regions">) {
  const { range } = await rangeFromSearchParams(searchParams);
  const [regions, unmapped] = await Promise.all([getRegionsDaily(range), getUnmappedCities(range)]);

  const summary = regions.state === "ok" ? summarizeRegions(regions.data) : [];
  const total = summary.reduce((a, r) => a + r.fresh_orders, 0);
  const unmappedOrders = summary.find((r) => r.region === "Unmapped")?.fresh_orders ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Regional analysis"
        description="Fresh orders by mapped region. Unmapped cities are kept as their own row so regional totals always reconcile."
        range={range}
        sources={["regions", "orders"]}
      />

      <Callout tone="warning">
        Regions come from the existing city mapping (Mumbai Belt, NCR, Pune, BLR, Kolkata, HYD, CHN). There is no Tier 3 definition yet, so
        no city is labelled Tier 3. CAC by region is not shown: Meta spend is not split by region in the current data.
      </Callout>

      <KpiGrid cols={3}>
        <KpiCard metric="fresh_orders" state={regions.state} value={regions.state === "ok" ? total : null} />
        <KpiCard metric="regional_unmapped_share" state={regions.state} value={total ? unmappedOrders / total : null} />
        <KpiCard metric="fresh_revenue" state={regions.state} value={regions.state === "ok" ? summary.reduce((a, r) => a + r.fresh_revenue, 0) : null} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <ChartCard title="Fresh orders by region" result={regions}>
          <FunnelBars steps={summary.map((r) => ({ label: r.region, value: r.fresh_orders }))} />
        </ChartCard>
        <ChartCard title="Region summary" result={regions} footnote="Order and revenue shares are of all Fresh orders in the period, including Unmapped.">
          <DataTable columns={REGION_COLUMNS} rows={summary.map((r) => ({ ...r }))} searchable={false} exportName={`regions-${range.from}-${range.to}`} />
        </ChartCard>
      </div>

      <ChartCard title="Cities that need a region" question="Which unmapped cities matter most?" result={unmapped}>
        <DataTable columns={UNMAPPED_COLUMNS} rows={unmapped.state === "ok" ? unmapped.data : []} pageSize={20} />
      </ChartCard>

      <SourceNotes sources={["regions", "orders"]} />
    </div>
  );
}
