import "server-only";

import type { z } from "zod";
import { QUERIES, type QueryParams } from "./queries";
import type { SqlName } from "./sql";
import { SupabaseReadError } from "./supabase";

// Every reporting query is a read over Supabase REST (lib/db/supabase.ts exposes SELECT only), aggregated in
// lib/db/queries.ts. This wrapper validates the aggregated output, so only the columns a schema lists can leave.

export class QueryError extends Error {
  constructor(
    public readonly sqlName: SqlName,
    message: string,
    /** Postgres/PostgREST error code, e.g. 42501 = permission denied. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

const SLOW_QUERY_MS = 3000;

/**
 * Run a registered reporting query and validate every row against its zod schema.
 * Columns not in the schema are stripped, so PII can't leak through an accidental extra field.
 */
export async function queryReadOnly<S extends z.ZodTypeAny>(name: SqlName, params: QueryParams, schema: S): Promise<z.infer<S>[]> {
  const run = QUERIES[name];
  if (!run) throw new QueryError(name, `Unknown query: ${name}`);
  try {
    const started = Date.now();
    const raw = await run(params);
    // Pages must render within Netlify's ~10 s function limit; flag the queries that eat into it (name only, no params).
    const ms = Date.now() - started;
    if (ms > SLOW_QUERY_MS) console.warn(`[db] ${name} slow: ${ms} ms, ${raw.length} rows`);
    const rows: z.infer<S>[] = [];
    for (const r of raw) {
      const parsed = schema.safeParse(r);
      if (!parsed.success) {
        throw new QueryError(name, `Row failed validation: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      }
      rows.push(parsed.data);
    }
    return rows;
  } catch (err) {
    // Log the query name and database error only — never the parameter values.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[db] ${name} failed: ${msg}`);
    if (err instanceof QueryError) throw err;
    throw new QueryError(name, msg, err instanceof SupabaseReadError ? err.code : undefined);
  }
}
