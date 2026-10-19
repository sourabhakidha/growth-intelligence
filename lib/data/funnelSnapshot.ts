import "server-only";

import { todayIST, type DateRange } from "@/lib/format/ist";
import { AF_COVERAGE_FROM, buildFunnelSnapshot, type SnapshotWindow } from "@/lib/metrics/funnel";
import { compareWindows } from "@/lib/metrics/metaIntel";
import type { DataResult } from "@/lib/types/result";
import type { AfFunnelRow } from "@/lib/types/schemas";
import { getAfFunnelWindows } from "./afEvents";
import { getOrdersDaily } from "./orders";

/**
 * Today / yesterday / last 7 days / MTD (anchored to today, IST) plus the selected range, each with its comparison.
 * One AppsFlyer read counts every window separately (distinct devices cannot be added across days); one orders read
 * spans every window, since order counts can.
 */
export async function loadFunnelSnapshot(range: DateRange) {
  const today = todayIST();
  const windows = compareWindows(range, today);
  const from = windows.reduce((m, w) => (w.cmpFrom < m ? w.cmpFrom : m), range.from);
  // No comparison for today (in progress) or when the comparison starts before AppsFlyer coverage.
  const afCmpOk = (w: (typeof windows)[number]) => w.id !== "today" && w.cmpFrom >= AF_COVERAGE_FROM;
  const [orders, af] = await Promise.all([
    getOrdersDaily({ from, to: today }),
    getAfFunnelWindows([
      ...windows.map((w) => ({ id: `${w.id}_cur`, from: w.from, to: w.to })),
      ...windows.filter(afCmpOk).map((w) => ({ id: `${w.id}_cmp`, from: w.cmpFrom, to: w.cmpTo })),
    ]),
  ]);
  // [] = the read worked but the window had no events (zero); null = AppsFlyer could not be read.
  const afRows = (id: string): readonly AfFunnelRow[] | null =>
    af.state === "ok" ? af.data.filter((r) => r.window === id) : af.state === "empty" ? [] : null;

  const snap: SnapshotWindow[] = windows.map((w) => ({
    key: w.id,
    from: w.from,
    to: w.to,
    cmpFrom: w.cmpFrom,
    cmpTo: w.cmpTo,
    af: afRows(`${w.id}_cur`),
    afCmp: afCmpOk(w) ? afRows(`${w.id}_cmp`) : null,
    noCmp: w.id === "today" ? "day in progress" : null,
    afNoCmp: afCmpOk(w) ? null : "before AppsFlyer data",
  }));
  const rows = buildFunnelSnapshot(snap, orders.state === "ok" ? orders.data : orders.state === "empty" ? [] : null);
  // The card shows a source's state only when nothing at all could be read.
  const failed = [orders, af].filter((r) => r.state !== "ok" && r.state !== "empty");
  const result: DataResult<unknown> | undefined = failed.length === 2 ? failed[0] : undefined;
  return { windows, rows, result };
}
