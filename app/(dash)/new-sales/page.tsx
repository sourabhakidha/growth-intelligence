import type { Metadata } from "next";
import { AovTrendChart } from "@/components/charts/AovTrendChart";
import { ChartCard } from "@/components/charts/ChartCard";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PeriodMatrix, matrixWindows, type MatrixRow } from "@/components/kpi/PeriodMatrix";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getAovFresh, getOrdersDaily, getPaymentMix, getUniqueCustomers } from "@/lib/data/orders";
import { formatINR } from "@/lib/format/inr";
import { todayIST } from "@/lib/format/ist";
import { aovInsights, bracketMix, breakdown, dailyAov, platformPayment, windowAgg, type Breakdown } from "@/lib/metrics/aov";
import { summarizeFresh } from "@/lib/metrics/compute";
import { compareWindows } from "@/lib/metrics/metaIntel";
import { dateSpine, freshByChannelDaily } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";
import type { OrderChannel } from "@/lib/types/schemas";

export const metadata: Metadata = { title: "New Sales" };

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  APP: "APP (self-serve)",
  WEB: "WEB (sales-assisted)",
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
  { key: "web", label: "WEB", format: "count" },
  { key: "fresh_total", label: "Total", format: "count" },
  { key: "fresh_revenue", label: "Revenue", format: "inr" },
  { key: "completed_fresh_revenue", label: "Completed revenue", format: "inr" },
  { key: "aov", label: "AOV", format: "inr" },
];

const BRACKET_COLUMNS: TableColumn[] = [
  { key: "label", label: "AOV bracket", format: "text", hint: "Lower bound inclusive, upper exclusive: ₹100 is in ₹100–200, ₹600 in ₹600+." },
  { key: "orders", label: "Fresh orders", format: "count" },
  { key: "order_share", label: "Order share", format: "pct" },
  { key: "revenue", label: "Revenue", format: "inr" },
  { key: "revenue_share", label: "Revenue share", format: "pct" },
  { key: "aov", label: "AOV", format: "inr" },
  { key: "order_share_prev", label: "Order share, comparison", format: "pct" },
  { key: "share_change", label: "Δ share (pts)", format: "pct", hint: "Change in order share, percentage points." },
];

const BREAKDOWN_COLUMNS: TableColumn[] = [
  { key: "label", label: "Group", format: "text" },
  { key: "orders", label: "Fresh orders", format: "count" },
  { key: "share", label: "Order share", format: "pct" },
  { key: "share_change", label: "Δ share (pts)", format: "pct" },
  { key: "aov", label: "AOV", format: "inr" },
  { key: "aov_prev", label: "AOV, prev.", format: "inr" },
  { key: "aov_change", label: "Δ AOV", format: "pct" },
  { key: "high_share", label: "₹600+ share", format: "pct" },
  { key: "low_share", label: "Under ₹200", format: "pct" },
  { key: "mix_effect", label: "Mix effect (₹)", format: "inr_precise", hint: "AOV change caused by this group's order share moving: Δshare × (group AOV − overall AOV), previous period. Gaining share pulls AOV up only if the group is above average." },
  { key: "rate_effect", label: "Basket effect (₹)", format: "inr_precise", hint: "AOV change caused by this group's own AOV moving (current share × ΔAOV). Mix + basket effects of all rows = total AOV change." },
];

function DecompositionNote({ b }: { b: Breakdown }) {
  if (!b.totalPrev || b.total.aov === null || b.totalPrev.aov === null || b.mix === null || b.rate === null) return null;
  const sign = (x: number) => `${x >= 0 ? "+" : "−"}${formatINR(Math.abs(x))}`;
  return (
    <p className="mb-2 text-xs text-ink-2">
      AOV {formatINR(b.totalPrev.aov)} → {formatINR(b.total.aov)} ({sign(b.total.aov - b.totalPrev.aov)}) = order-mix effect <strong className="text-ink">{sign(b.mix)}</strong> + basket-size effect{" "}
      <strong className="text-ink">{sign(b.rate)}</strong>.
    </p>
  );
}

export default async function NewSalesPage({ searchParams }: PageProps<"/new-sales">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const today = todayIST();
  // Today / Yesterday / Last 7 days / MTD (anchored to today) + the selected range, each with its own comparison.
  const periods = compareWindows(range, today);
  const day = periods.find((p) => p.id === "day")!;
  const mtd = periods.find((p) => p.id === "mtd")!;
  const aovFrom = [previous.from, ...periods.map((p) => p.cmpFrom)].reduce((a, b) => (b < a ? b : a));
  const [orders, ordersPrev, uniq, pay, aovRes] = await Promise.all([
    getOrdersDaily(range),
    getOrdersDaily(previous),
    getUniqueCustomers(range),
    getPaymentMix(range),
    getAovFresh({ from: aovFrom, to: today }),
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
      ? (["APP", "WEB"] as OrderChannel[]).map((ch) => {
          const rs = orders.data.filter((r) => r.order_type === "Fresh" && r.channel === ch);
          const ordersN = rs.reduce((a, r) => a + r.orders, 0);
          const revenue = rs.reduce((a, r) => a + r.revenue, 0);
          const uniqKey = ch === "APP" ? "unique_customers_app" : "unique_customers_web";
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

  // ---------- AOV intelligence ----------
  const aovRows = aovRes.state === "ok" ? aovRes.data : [];
  const win = (p: { from: string; to: string }) => ({ from: p.from, to: p.to });
  const cmp = (p: { cmpFrom: string; cmpTo: string }) => ({ from: p.cmpFrom, to: p.cmpTo });
  const aovRange = windowAgg(aovRows, range.from, range.to);
  const aovRangePrev = windowAgg(aovRows, previous.from, previous.to);
  const bracketsDay = bracketMix(aovRows, win(day), cmp(day));
  const bracketsMtd = bracketMix(aovRows, win(mtd), cmp(mtd));
  const bracketsRange = bracketMix(aovRows, range, previous);
  const aovDaily = dailyAov(aovRows.filter((r) => r.order_date >= range.from && r.order_date <= range.to), dateSpine(range.from, range.to));
  const byDim = (["channel", "payment_mode", "region"] as const).map((d) => breakdown(aovRows, d, range, previous));
  const platPay = platformPayment(aovRows, range, previous);
  const aovIns = aovRes.state === "ok"
    ? aovInsights({ label: "The selected period", cmpLabel: "The previous period", cur: aovRange, prev: aovRangePrev.orders ? aovRangePrev : null, brackets: bracketsRange, byDim, platformPay: platPay })
    : [];
  // AOV by period: every measure for each window vs that window's own comparison.
  const perWindow = periods.map((p) => {
    const cur = windowAgg(aovRows, p.from, p.to);
    const prev = windowAgg(aovRows, p.cmpFrom, p.cmpTo);
    const mix = bracketMix(aovRows, win(p), cmp(p));
    const share = (keys: string[], k: "order_share" | "order_share_prev") => mix.filter((r) => keys.includes(r.bracket)).reduce((a, r) => a + (r[k] ?? 0), 0);
    // Today is in progress: totals are not compared with a full day (AOV and shares are).
    const noCmp = p.id === "today" ? "day in progress" : null;
    return { cur, prev, noCmp, hi: cur.orders ? share(["b600_plus"], "order_share") : null, hiPrev: prev.orders ? share(["b600_plus"], "order_share_prev") : null, lo: cur.orders ? share(["b0_100", "b100_200"], "order_share") : null, loPrev: prev.orders ? share(["b0_100", "b100_200"], "order_share_prev") : null };
  });
  const aovMatrix: MatrixRow[] = [
    { key: "aov", label: "AOV (Fresh)", sub: "revenue ÷ orders", format: "inr", up: true, cells: perWindow.map((w) => ({ value: w.cur.aov, cmp: w.prev.aov })) },
    { key: "orders", label: "Fresh orders", sub: "APP + WEB", format: "count", up: true, cells: perWindow.map((w) => ({ value: w.cur.orders, cmp: w.prev.orders, noCmp: w.noCmp })) },
    { key: "revenue", label: "Fresh revenue", sub: "finalAmount", format: "inr", up: true, cells: perWindow.map((w) => ({ value: w.cur.revenue, cmp: w.prev.revenue, noCmp: w.noCmp })) },
    { key: "hi", label: "Orders at ₹600+", sub: "share of Fresh orders", format: "pct", up: true, change: "points", cells: perWindow.map((w) => ({ value: w.hi, cmp: w.hiPrev })) },
    { key: "lo", label: "Orders under ₹200", sub: "share of Fresh orders", format: "pct", up: false, change: "points", cells: perWindow.map((w) => ({ value: w.lo, cmp: w.loPrev })) },
  ];
  const reconciles = f !== null && aovRes.state === "ok" ? aovRange.orders === f.fresh_orders : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="New sales and unit economics"
        description="Fresh orders (new-customer sales) by channel, with revenue, completion and customer counts kept separate."
        range={range}
        sources={["orders"]}
      />

      <KpiGrid cols={4}>
        <KpiCard metric="fresh_orders" state={orders.state} value={f?.fresh_orders} previous={fp?.fresh_orders} />
        <KpiCard metric="fresh_app" state={orders.state} value={f?.fresh_app} previous={fp?.fresh_app} />
        <KpiCard metric="fresh_web" state={orders.state} value={f?.fresh_web} previous={fp?.fresh_web} />
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
            { key: "web", label: "WEB (sales-assisted)", color: "web" },
          ]}
        />
      </ChartCard>

      <div className="grid gap-4">
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

      {/* ---------- New Sales AOV intelligence ---------- */}
      <div className="pt-2">
        <h2 className="text-base font-semibold text-ink">New Sales AOV intelligence</h2>
        <p className="text-xs text-ink-2">
          AOV = eligible Fresh-order revenue ÷ unique eligible Fresh orders (APP + WEB, excluding PRESCRIPTION_UPLOADED, DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT).
          {reconciles === true ? ` Brackets reconcile: ${aovRange.orders.toLocaleString("en-IN")} orders, the same as the Fresh orders KPI.` : reconciles === false ? " Bracket total differs from the Fresh orders KPI — check the source." : ""}
        </p>
      </div>
      <ChartCard
        title="AOV by period"
        question="Today vs yesterday vs last 7 days vs month to date, and the selected range. Each cell: value, then change vs that period's own comparison (hover a column heading for it)."
        result={aovRes}
        footnote="Last 7 days and MTD are complete days ending yesterday, compared with the prior 7 days and the same days last month; the selected range is compared with the previous period of the same length. Today is in progress: its order and revenue totals are not compared, AOV and shares are."
      >
        <PeriodMatrix windows={matrixWindows(periods)} rows={aovMatrix} />
      </ChartCard>

      <ChartCard
        title="AOV, Fresh-order volume and bracket mix"
        question="Is AOV moving because baskets changed size, or because the order mix changed? Bar height = Fresh orders; segments = AOV brackets; red lines = AOV."
        result={aovRes}
        footnote="Left axis: Fresh orders per day (or each bracket's share of the day's orders in mix view). Right axis (red): AOV, daily (dashed) and trailing 7 days (solid, Σ revenue ÷ Σ orders of the 7 days). Brackets: lower bound inclusive, upper exclusive. Today, if included, is a partial day."
      >
        <AovTrendChart data={aovDaily} />
      </ChartCard>

      <div className="grid gap-4">
        <ChartCard className="min-w-0" title={`AOV brackets — ${day.label}`} question={day.cmpLabel} result={aovRes} footnote="Every eligible Fresh order is in exactly one bracket.">
          <DataTable columns={BRACKET_COLUMNS} rows={bracketsDay.map((r) => ({ ...r }))} searchable={false} />
        </ChartCard>
        <ChartCard className="min-w-0" title={`AOV brackets — ${mtd.label}`} question={mtd.cmpLabel} result={aovRes} footnote="Order share and revenue share add up to 100% across brackets.">
          <DataTable columns={BRACKET_COLUMNS} rows={bracketsMtd.map((r) => ({ ...r }))} searchable={false} />
        </ChartCard>
      </div>

      <ChartCard
        title="AOV insights"
        question="What changed → evidence → likely driver (confirmed or hypothesis) → business impact → action → verification metric. Selected date range vs the previous period of the same length."
        result={aovRes}
        footnote="Confirmed = arithmetic from order data (e.g. the mix / basket split). Hypothesis = a likely explanation the data does not prove. Groups with fewer than 20 orders are not used to explain AOV."
      >
        <InsightPanel insights={aovIns} />
      </ChartCard>

      <div className="grid gap-4">
        {byDim.slice(0, 2).map((b) => (
          <ChartCard key={b.dim} className="min-w-0" title={b.dim === "channel" ? "AOV by order platform" : "AOV by payment mode"} question="Selected date range vs previous period." result={aovRes}>
            <DecompositionNote b={b} />
            <DataTable columns={BREAKDOWN_COLUMNS} rows={b.rows.map((r) => ({ ...r }))} searchable={false} />
          </ChartCard>
        ))}
        <ChartCard className="min-w-0" title="AOV by platform × payment mode" question="Where platform and payment differences combine." result={aovRes}>
          <DecompositionNote b={platPay} />
          <DataTable columns={BREAKDOWN_COLUMNS} rows={platPay.rows.map((r) => ({ ...r, label: r.key }))} searchable={false} />
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="AOV by region"
          question="Priority Mumbai pincodes, Tier 1, Delhi NCR, Tier 2, Tier 3 — the Regional page's definitions."
          result={aovRes}
          footnote="Region from the order pincode (lib/geo/regions.ts, first match wins). Orders without a valid pincode are 'Location not verified', never Tier 3."
        >
          <DecompositionNote b={byDim[2]} />
          <DataTable columns={BREAKDOWN_COLUMNS} rows={byDim[2].rows.map((r) => ({ ...r }))} searchable={false} />
        </ChartCard>
      </div>

      <ChartCard title="Daily detail" result={orders}>
        <DataTable columns={DAILY_COLUMNS} rows={daily} exportName={`new-sales-daily-${range.from}-${range.to}`} />
      </ChartCard>

      <SourceNotes sources={["orders"]} />
    </div>
  );
}
