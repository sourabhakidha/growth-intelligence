import "server-only";

import type { z } from "zod";
import { assertUser } from "@/lib/auth/guard";
import { QueryError, queryReadOnly } from "@/lib/db/readonly";
import { isDatabaseConfigured } from "@/lib/db/supabase";
import type { SqlName } from "@/lib/db/sql";
import { isIsoDate, type DateRange } from "@/lib/format/ist";
import type { DataResult, SourceId } from "@/lib/types/result";

/**
 * Live queries run only when DATA_ENABLED=true AND SUPABASE_URL + SUPABASE_SERVICE_KEY are set. Phase 2A ships with live data off,
 * so every screen renders its "not connected" state — never mock numbers.
 */
export function isLiveDataEnabled(): boolean {
  return process.env.DATA_ENABLED === "true" && isDatabaseConfigured();
}

function notConnectedReason(): string {
  if (process.env.DATA_ENABLED !== "true") return "Live data is switched off (Phase 2A shell).";
  return "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).";
}

export function assertRange(range: DateRange): void {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new Error("Invalid date range");
  }
}

export async function runSource<S extends z.ZodTypeAny>(
  source: SourceId,
  sqlName: SqlName,
  params: readonly (string | number | null)[],
  schema: S,
): Promise<DataResult<z.infer<S>[]>> {
  await assertUser(); // authorization is re-checked at the data layer, not only in proxy/layout
  if (!isLiveDataEnabled()) return { state: "not_connected", source, reason: notConnectedReason() };
  try {
    const rows = await queryReadOnly(sqlName, params, schema);
    const fetchedAt = new Date().toISOString();
    if (rows.length === 0) return { state: "empty", source, fetchedAt, reason: "No rows for the selected dates." };
    return { state: "ok", source, data: rows, fetchedAt };
  } catch (err) {
    // 42501: the service key has no SELECT grant on this source yet — show it as not connected, not broken.
    if (err instanceof QueryError && err.code === "42501") {
      return { state: "not_connected", source, reason: "The Supabase service key has no read access to this source yet." };
    }
    // Details are logged server-side in queryReadOnly; the browser gets a generic message.
    return { state: "error", source, message: `Could not load ${sqlName}. See server logs.` };
  }
}

export function rangeParams(range: DateRange): [string, string] {
  assertRange(range);
  return [range.from, range.to];
}
