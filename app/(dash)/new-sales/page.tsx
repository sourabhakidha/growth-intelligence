import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getOrdersDaily, getPaymentMix, getUniqueCustomers } from "@/lib/data/orders";
import { summarizeFresh } from "@/lib/metrics/compute";
import { freshByChannelDaily } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";
import type { OrderChannel } from "@/lib/types/schemas";

export const metadata: Metadata = { title: "New Sales" };

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  APP: "APP (self-serve)",
  WEB_AGENT: "WEB (agent)",
  WEB_OTHER: "WEB (other)",
};

const CHANNEL_COLUMNS: TableColumn[] = [
  { key: "channel", label: "Channel", format: "text" },
  { key: "orders", label: "Fresh orders", format: "count" },
  { key: "unique_customers", label: "Unique customers", format: "count", hint: "Distinct within this channel. Channels overlap, so do not add them up." },
  { key: "revenue", label: "Revenue", format: "inr" },
  { key: "completed_orders", label: "Completed", format: "count" },
  { key: "completed_revenue", label: "Completed revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr" },
];

const PAYMENT_COLUMNS: TableColumn[] = [
  { key: "channel", label: "Channel", format: "text" },
  { key: "payment_mode", label: "Payment mode", format: "text" },
  { key: "orders", label: "Fresh orders", format: "count" },
  { key: "share", label: "Share of channel", format: "pct" },
  { key: "revenue", label: "Revenue", format: "inr" },
];

const DAILY_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "app", label: "APP", format: "count" },
  { key: "web_agent", label: "WEB agent", format: "count" },
  { key: "web_other", label: "WEB other", format: "count" },
  { key: "fresh_total", label: "Total", format: "count" },
  { key: "fresh_revenue", label: "Revenue", format: "inr" },
  { key: "completed_fresh_revenue", label: "Completed revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr" },
];

export default async function NewSalesPage({ searchParams }: PageProps<"/new-sales">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const [orders, ordersPrev, uniq, pay] = await Promise.all([
    getOrdersDaily(range),
    getOrdersDaily(previous),
    getUniqueCustomers(range),
    getPaymentMix(range),
  ]);

  const f = orders.state === "ok" ? summarizeFresh(orders.data) : null;
  const fp = ordersPrev.state === "ok" ? summarizeFresh(ordersPrev.data) : null;
  const freshUniq = uniq.state === "ok" ? uniq.data.find((r) => r.order_type === "Fresh") : undefined;
  const daily = orders.state === "ok" ? freshByChannelDaily(orders.data, range.from, range.to) : [];

  const ageRows = orders.state === "ok" ? orders.data.filter((r) => r.order_type === "Fresh" && r.avg_patient_age !== null) : [];
  const ageWeighted = ageRows.length
    ? ageRows.reduce((a, r) => a + (r.avg_patient_age as number) * r.orders, 0) / ageRows.reduce((a, r) => a + r.orders, 0)
    : null;

  const channelRows =
    orders.state === "ok"
      ? (["APP", "WEB_AGENT", "WEB_OTHER"] as OrderChannel[]).map((ch) => {
          const rs = orders.data.filter((r) => r.order_type === "Fresh" && r.channel === ch);
          const ordersN = rs.reduce((a, r) => a + r.orders, 0);
          const revenue = rs.reduce((a, r) => a + r.revenue, 0);
          const uniqKey = ch === "APP" ? "unique_customers_app" : ch === "WEB_AGENT" ? "unique_customers_web_agent" : "unique_customers_web_other";
          return {
            channel: CHANNEL_LABEL[ch],
            orders: ordersN,
            unique_customers: freshUniq ? freshUniq[uniqKey] : null,
            revenue,
            completed_orders: rs.reduce((a, r) => a + r.completed_orders, 0),
            completed_revenue: rs.reduce((a, r) => a + r.completed_revenue, 0),
            aov: ordersN ? revenue / ordersN : null,
          };
        })
      : [];

  const channelTotals = new Map<string, number>();
  if (pay.state === "ok") for (const r of pay.data) channelTotals.set(r.channel, (channelTotals.get(r.channel) ?? 0) + r.orders);
  const payRows =
    pay.state === "ok"
      ? pay.data.map((r) => ({
          channel: CHANNEL_LABEL[r.channel],
          payment_mode: r.payment_mode,
          orders: r.orders,
          share: channelTotals.get(r.channel) ? r.orders / (channelTotals.get(r.channel) as number) : null,
          revenue: r.revenue,
        }))
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="New sales and unit economics"
        description="Fresh orders (new-customer sales) by channel, with revenue, completion and customer counts kept separate."
        range={range}
        sources={["orders"]}
      />

      <KpiGrid cols={5}>
        <KpiCard metric="fresh_orders" state={orders.state} value={f?.fresh_orders} previous={fp?.fresh_orders} />
        <KpiCard metric="fresh_app" state={orders.state} value={f?.fresh_app} previous={fp?.fresh_app} />
        <KpiCard metric="fresh_web_agent" state={orders.state} value={f?.fresh_web_agent} previous={fp?.fresh_web_agent} />
        <KpiCard metric="fresh_web_other" state={orders.state} value={f?.fresh_web_other} previous={fp?.fresh_web_other} />
        <KpiCard metric="unique_new_customers" state={uniq.state} value={freshUniq?.unique_customers_all} />
        <KpiCard metric="fresh_revenue" state={orders.state} value={f?.fresh_revenue} previous={fp?.fresh_revenue} />
        <KpiCard metric="completed_fresh_revenue" state={orders.state} value={f?.completed_fresh_revenue} previous={fp?.completed_fresh_revenue} />
        <KpiCard metric="aov_fresh" state={orders.state} value={f?.aov_fresh} previous={fp?.aov_fresh} />
        <KpiCard metric="avg_patient_age" state={orders.state} value={ageWeighted} />
      </KpiGrid>

      <ChartCard title="Daily Fresh orders by channel" result={orders}>
        <TrendChart
          data={daily}
          xKey="date"
          format="count"
          kind="bar"
          stacked
          series={[
            { key: "app", label: "APP (self-serve)", color: "app" },
            { key: "web_agent", label: "WEB (agent)", color: "web_agent" },
            { key: "web_other", label: "WEB (other)", color: "web_other" },
          ]}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="By channel"
          question="How do self-serve and sales-assisted new sales compare?"
          result={orders}
          footnote="Unique customers are distinct within each channel. A customer can order on both, so the total unique count is the KPI above, not the sum."
        >
          <DataTable columns={CHANNEL_COLUMNS} rows={channelRows} searchable={false} />
        </ChartCard>
        <ChartCard title="Payment mix (Fresh orders)" result={pay}>
          <DataTable columns={PAYMENT_COLUMNS} rows={payRows} searchable={false} pageSize={10} />
        </ChartCard>
      </div>

      <ChartCard title="Daily detail" result={orders}>
        <DataTable columns={DAILY_COLUMNS} rows={daily} exportName={`new-sales-daily-${range.from}-${range.to}`} />
      </ChartCard>

      <SourceNotes sources={["orders"]} />
    </div>
  );
}
