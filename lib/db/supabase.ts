import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase REST (PostgREST) access with the service key — no Postgres pooler, no direct connection.
// This module only ever issues SELECTs: the read helpers below expose no insert/update/delete/rpc.
//
// Required env (server only — never prefix with NEXT_PUBLIC_):
//   SUPABASE_URL          https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (bypasses RLS, so it must never reach the browser)

declare global {
  var __growthSupabase: SupabaseClient | undefined;
}

/** PostgREST caps every response at this many rows (db-max-rows), so larger reads are paged. */
const PAGE_SIZE = 1000;
/** Pages fetched concurrently per read. */
const PAGE_CONCURRENCY = 24;
/** Values per `in.(...)` filter, keeping request URLs well under proxy limits. */
const IN_CHUNK = 150;
/** `in.(...)` chunks fetched concurrently (user / lead lookups after a large event read sit on the critical path). */
const IN_CONCURRENCY = 8;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function getClient(): SupabaseClient {
  if (!globalThis.__growthSupabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set");
    globalThis.__growthSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "growth-dashboard (read-only)" } },
    });
  }
  return globalThis.__growthSupabase;
}

/** The read-only subset of the PostgREST query builder the reporting queries use. */
export interface Select extends PromiseLike<{ data: unknown; error: { message: string; code: string } | null; count: number | null }> {
  eq(column: string, value: unknown): Select;
  gt(column: string, value: unknown): Select;
  gte(column: string, value: unknown): Select;
  lt(column: string, value: unknown): Select;
  lte(column: string, value: unknown): Select;
  in(column: string, values: readonly unknown[]): Select;
  not(column: string, operator: string, value: unknown): Select;
  order(column: string, options?: { ascending?: boolean }): Select;
  range(from: number, to: number): Select;
  limit(count: number): Select;
}
export type Filter = (q: Select) => Select;

function from(schema: string, table: string, columns: string, count = false): Select {
  return getClient()
    .schema(schema)
    .from(table)
    .select(columns, count ? { count: "exact" } : undefined) as unknown as Select;
}

export class SupabaseReadError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "SupabaseReadError";
  }
}

export interface ReadSpec {
  schema: string;
  table: string;
  /** Explicit column list — never "*". */
  columns: string;
  /** Columns that together are unique, so paging is stable. */
  orderBy: readonly string[];
  filter?: Filter;
  /**
   * Unique integer key (and the only orderBy column). Large reads are then split into key ranges fetched in
   * parallel, each an index range scan, instead of deep OFFSET pages that rescan everything before them.
   */
  keyColumn?: string;
}

function build(spec: ReadSpec, count: boolean): Select {
  let q = from(spec.schema, spec.table, spec.columns, count);
  if (spec.filter) q = spec.filter(q);
  for (const col of spec.orderBy) q = q.order(col, { ascending: true });
  return q;
}

async function page(spec: ReadSpec, from: number, count: boolean): Promise<{ rows: Record<string, unknown>[]; total: number | null }> {
  const { data, error, count: total } = await build(spec, count).range(from, from + PAGE_SIZE - 1);
  if (error) throw new SupabaseReadError(`${spec.schema}.${spec.table}: ${error.message}`, error.code);
  return { rows: (data ?? []) as Record<string, unknown>[], total: total ?? null };
}

/** Reads every matching row, paging past the PostgREST row cap. */
export async function selectAll(spec: ReadSpec): Promise<Record<string, unknown>[]> {
  const first = await page(spec, 0, true);
  const total = first.total ?? first.rows.length;
  if (total <= PAGE_SIZE) return first.rows;
  if (spec.keyColumn) return first.rows.concat(await selectByKeyRanges(spec, spec.keyColumn, first.rows, total));
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < total; o += PAGE_SIZE) offsets.push(o);
  const rest = await mapLimit(offsets, PAGE_CONCURRENCY, async (o) => (await page(spec, o, false)).rows);
  return first.rows.concat(...rest);
}

async function selectByKeyRanges(spec: ReadSpec, key: string, firstRows: Record<string, unknown>[], total: number) {
  const after = Number(firstRows[firstRows.length - 1][key]);
  const max = Number(await maxOf(spec.schema, spec.table, key, spec.filter));
  // Slices sized for ~80% of a page each; a denser slice simply takes another keyset page.
  const slices = Math.max(1, Math.ceil((total - firstRows.length) / (PAGE_SIZE * 0.8)));
  const width = Math.max(1, Math.ceil((max - after) / slices));
  const bounds: [number, number][] = [];
  for (let lo = after; lo < max; lo += width) bounds.push([lo, Math.min(lo + width, max)]);
  const parts = await mapLimit(bounds, PAGE_CONCURRENCY, async ([lo, hi]) => {
    const rows: Record<string, unknown>[] = [];
    for (let cursor = lo; ; ) {
      const base = spec.filter;
      const { rows: got } = await page({ ...spec, filter: (q) => (base ? base(q) : q).gt(key, cursor).lte(key, hi) }, 0, false);
      rows.push(...got);
      if (got.length < PAGE_SIZE) return rows;
      cursor = Number(got[got.length - 1][key]);
    }
  });
  return parts.flat();
}

/** selectAll restricted to `column in (values)`, split into URL-safe chunks. */
export async function selectIn(spec: ReadSpec, column: string, values: readonly (string | number)[]): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(values)];
  if (unique.length === 0) return [];
  const chunks: (string | number)[][] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) chunks.push(unique.slice(i, i + IN_CHUNK));
  const parts = await mapLimit(chunks, IN_CONCURRENCY, (chunk) =>
    selectAll({ ...spec, filter: (q) => (spec.filter ? spec.filter(q) : q).in(column, chunk) }),
  );
  return parts.flat();
}

/** Greatest non-null value of one column (`select max(col)`), or null. */
export async function maxOf(schema: string, table: string, column: string, filter?: Filter): Promise<unknown> {
  let q = from(schema, table, column);
  if (filter) q = filter(q);
  const { data, error } = await q.not(column, "is", null).order(column, { ascending: false }).limit(1);
  if (error) throw new SupabaseReadError(`${schema}.${table}: ${error.message}`, error.code);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return row ? row[column] : null;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
