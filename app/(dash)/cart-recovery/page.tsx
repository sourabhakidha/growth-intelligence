import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { PendingDefinitionState } from "@/components/state/States";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getCartLeadsDaily } from "@/lib/data/cartLeads";
import { getCartLeadLifecycleDaily } from "@/lib/data/crmLifecycle";
import { summarizeCartLeads } from "@/lib/metrics/compute";
import { dateSpine } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Abandoned Cart Recovery" };

const LIFECYCLE_COLUMNS: TableColumn[] = [
  { key: "lead_date", label: "Lead date", format: "date" },
  { key: "leads", label: "Leads", format: "count" },
  { key: "with_task", label: "Handed to sales", format: "count" },
  { key: "dialled", label: "Dialled", format: "count" },
  { key: "won_any_order", label: "Any order after lead*", format: "count" },
  { key: "won_fresh_app", label: "Fresh APP*", format: "count" },
  { key: "won_fresh_web_agent", label: "Fresh WEB agent*", format: "count" },
  { key: "median_min_cart_to_lead", label: "Cart → lead (median)", format: "minutes" },
];

export default async function CartRecoveryPage({ searchParams }: PageProps<"/cart-recovery">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const [leads, leadsPrev, life] = await Promise.all([
    getCartLeadsDaily(range),
    getCartLeadsDaily(previous),
    getCartLeadLifecycleDaily(range),
  ]);

  const l = leads.state === "ok" ? summarizeCartLeads(leads.data) : null;
  const lp = leadsPrev.state === "ok" ? summarizeCartLeads(leadsPrev.data) : null;
  const byDate = new Map(leads.state === "ok" ? leads.data.map((r) => [r.lead_date, r]) : []);
  const daily =
    leads.state === "ok"
      ? dateSpine(range.from, range.to).map((date) => {
          const r = byDate.get(date);
          return { date, fresh: r ? r.fresh : 0, repeat: r ? r.repeat : 0 };
        })
      : [];
  const lifeRows = life.state === "ok" ? life.data : [];
  const won = life.state === "ok" ? lifeRows.reduce((a, r) => a + r.won_any_order, 0) : null;
  const medians = lifeRows.map((r) => r.median_min_cart_to_lead).filter((v): v is number => v !== null);
  const medianOfDays = medians.length ? medians.sort((a, b) => a - b)[Math.floor(medians.length / 2)] : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Abandoned cart recovery"
        description="CRM abandoned-cart leads under the agreed definition, and what happened after the lead was created."
        range={range}
        sources={["crm_cart_leads", "crm_lifecycle"]}
      />

      <Callout tone="warning">
        Cart-lead counts use the definition agreed on 14 Oct 2026 (repeat = earlier COMPLETED order). CRM screens that read the live
        crm.cart_leads_std() now apply a different rule (changed 15 Oct), so their numbers will differ from these.
      </Callout>

      <KpiGrid cols={5}>
        <KpiCard metric="cart_leads" state={leads.state} value={l?.total} previous={lp?.total} />
        <KpiCard metric="cart_leads_fresh" state={leads.state} value={l?.fresh} previous={lp?.fresh} />
        <KpiCard metric="cart_leads_repeat" state={leads.state} value={l?.repeat} previous={lp?.repeat} />
        <KpiCard metric="cart_to_lead_minutes" state={life.state} value={medianOfDays} sublabel="median of daily medians" />
        <KpiCard metric="recovered_orders" state={life.state} value={won} />
      </KpiGrid>

      <ChartCard title="Daily cart leads — Fresh vs Repeat" question="Is new-customer cart intent rising?" result={leads}>
        <TrendChart
          data={daily}
          xKey="date"
          format="count"
          kind="bar"
          stacked
          series={[
            { key: "fresh", label: "Fresh", color: "accent" },
            { key: "repeat", label: "Repeat", color: "neutral" },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Lead lifecycle by lead date"
        result={life}
        status="provisional"
        footnote="* Task-level signal: a CRM task is per phone and can span several leads, and the CRM marks self-serve APP orders as won. These are not a final recovery attribution."
      >
        <DataTable columns={LIFECYCLE_COLUMNS} rows={lifeRows} exportName={`cart-lifecycle-${range.from}-${range.to}`} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Recovered vs self-converted" status="provisional">
          <PendingDefinitionState
            title="Needs the recovery attribution rule"
            detail="Which lead types count as cart recovery, the attribution window, and whether an agent contact must come before the order."
          />
        </ChartCard>
        <ChartCard title="Contact speed and outcomes" status="provisional">
          <PendingDefinitionState
            title="Phase 2B"
            detail="Time to first dial and first connect from crm.calls_* / crm.events_*, contact rate, and close reasons by lead age, region and customer type."
          />
        </ChartCard>
      </div>

      <SourceNotes sources={["crm_cart_leads", "crm_lifecycle"]} />
    </div>
  );
}
