import "server-only";

import type { z } from "zod";
import { getPool } from "./pool";
import { loadSql, type SqlName } from "./sql";

// The database role available today (postgres via the pooler) can write. This wrapper is the app-side
// guardrail: every query runs inside a READ ONLY transaction, so any INSERT/UPDATE/DELETE/DDL that slipped
// into a .sql file would be rejected by Postgres itself, and the transaction is always rolled back.

const STATEMENT_TIMEOUT_MS = 15_000;

export class QueryError extends Error {
  constructor(
    public readonly sqlName: SqlName,
    message: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

/**
 * Run a version-controlled SQL file read-only and validate every row against its zod schema.
 * Columns not in the schema are stripped, so PII can't leak through an accidental `select *`.
 */
export async function queryReadOnly<S extends z.ZodTypeAny>(
  name: SqlName,
  params: readonly (string | number | null)[],
  schema: S,
): Promise<z.infer<S>[]> {
  const sql = loadSql(name);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query("SET LOCAL idle_in_transaction_session_timeout = 20000");
    const res = await client.query({ text: sql, values: params as unknown[] });
    const rows: z.infer<S>[] = [];
    for (const raw of res.rows) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new QueryError(name, `Row failed validation: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      }
      rows.push(parsed.data);
    }
    return rows;
  } catch (err) {
    if (err instanceof QueryError) throw err;
    // Log the SQL file name and Postgres error only — never the parameter values.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[db] ${name} failed: ${msg}`);
    throw new QueryError(name, msg);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
