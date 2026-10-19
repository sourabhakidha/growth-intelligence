import "server-only";

import { addDays, todayIST, type DateRange } from "@/lib/format/ist";
import { buildActionInsights, type SalesSnapshot } from "@/lib/metrics/actionInsights";
import { summarizeFresh, summarizeMeta, uniqueFreshCustomers } from "@/lib/metrics/compute";
import { AF_COVERAGE_FROM, GA4_LAG_DAYS, buildAfFunnel, buildGa4Funnel } from "@/lib/metrics/funnel";
import { getAfFunnel } from "./afEvents";
import { getAppFunnelDaily } from "./appFunnel";
import { getMetaAccountDaily } from "./metaAds";
import { getOrdersDaily, getUniqueCustomers } from "./orders";

/**
 * Everything the Overview and App Funnel pages need to agree on: New Sales (eligible Fresh orders), distinct Fresh
 * customers, Meta spend, the AppsFlyer and GA4 funnels, and the action insights built from them — for the selected
 * range and the equal-length previous period.
 */
export async function loadGrowthContext(range: DateRange, previous: DateRange) {
  const afPrevComparable = previous.from >= AF_COVERAGE_FROM;
  const [orders, ordersPrev, uniq, uniqPrev, meta, metaPrev, afCur, afPrev, ga4, ga4Prev] = await Promise.all([
    getOrdersDaily(range),
    getOrdersDaily(previous),
    getUniqueCustomers(range),
    getUniqueCustomers(previous),
    getMetaAccountDaily(range),
    getMetaAccountDaily(previous),
    getAfFunnel(range),
    afPrevComparable ? getAfFunnel(previous) : Promise.resolve(null),
    getAppFunnelDaily(range),
    getAppFunnelDaily(previous),
  ]);

  const snap = (o: typeof orders, u: typeof uniq): SalesSnapshot | null => {
    if (o.state !== "ok") return null;
    const f = summarizeFresh(o.data);
    return {
      orders: f.fresh_orders,
      app: f.fresh_app,
      web: f.fresh_web,
      customers: u.state === "ok" ? (uniqueFreshCustomers(u.data) ?? 0) : 0,
      revenue: f.fresh_revenue,
    };
  };
  const sales = snap(orders, uniq);
  const salesPrev = snap(ordersPrev, uniqPrev);
  const spend = meta.state === "ok" ? summarizeMeta(meta.data).spend : null;
  const spendPrev = metaPrev.state === "ok" ? summarizeMeta(metaPrev.data).spend : null;

  const af = afCur.state === "ok" ? buildAfFunnel(afCur.data, afPrev && afPrev.state === "ok" ? afPrev.data : null) : null;
  const ga4Ok = ga4.state === "ok" || ga4.state === "empty";
  const ga4Funnel = ga4.state === "ok" ? buildGa4Funnel(ga4.data, ga4Prev.state === "ok" ? ga4Prev.data : null) : null;
  const ga4Complete = addDays(todayIST(), -GA4_LAG_DAYS);
  const ga4Incomplete = range.to > ga4Complete;

  const afCoverageNote =
    range.from < AF_COVERAGE_FROM
      ? `The selected range starts before AppsFlyer coverage (6 Oct 2026); funnel volumes cover only part of it.`
      : !afPrevComparable
        ? `The previous period (${previous.from} to ${previous.to}) starts before AppsFlyer coverage (6 Oct 2026), so funnel stages are not compared with it.`
        : null;

  const insights = buildActionInsights({
    sales,
    salesPrev,
    spend,
    spendPrev,
    metaConnected: meta.state !== "not_connected" && meta.state !== "error",
    af: af ? { stages: af.stages, paymentFailed: af.paymentFailed, atcNew: af.atc.newCustomer, atcRepeat: af.atc.repeatCustomer, comparable: af.comparable } : null,
    afCoverageNote,
    ga4Connected: ga4Ok,
    ga4Incomplete,
  });

  return {
    orders, ordersPrev, uniq, uniqPrev, meta, metaPrev, afCur, ga4, ga4Prev,
    sales, salesPrev, spend, spendPrev, af, ga4Funnel, ga4Incomplete, ga4CompleteThrough: ga4Complete, afCoverageNote, insights,
  };
}
