import "server-only";

import { Pool, type PoolConfig } from "pg";

// One small pool per server instance. Vercel functions are short-lived, so keep it small and let the
// Supabase pooler (Supavisor, transaction mode, port 6543) do the real pooling.
//
// Required env (server only — never prefix with NEXT_PUBLIC_):
//   DATABASE_URL      postgres://...pooler.supabase.com:6543/postgres
//   DATABASE_CA_CERT  optional: Supabase root CA (PEM). When set, TLS is verified against it.

declare global {
  var __growthPgPool: Pool | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function buildConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    // Supabase requires TLS. With the CA supplied the server certificate is verified; without it the
    // connection is still encrypted but the certificate chain is not pinned.
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    application_name: "growth-dashboard (read-only)",
  };
}

export function getPool(): Pool {
  if (!globalThis.__growthPgPool) {
    const pool = new Pool(buildConfig());
    pool.on("error", (err) => {
      // Never log connection strings or query parameters.
      console.error("[db] idle client error:", err.message);
    });
    globalThis.__growthPgPool = pool;
  }
  return globalThis.__growthPgPool;
}
