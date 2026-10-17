# Growth Intelligence Dashboard (Akidha)

An internal dashboard for performance marketing and growth. Built with Next.js 16 (App Router, TypeScript), deployed on Vercel, and reading the existing Supabase Postgres database **read-only**.

> Phase 2A status: app shell only. Live data is **off** (`DATA_ENABLED=false`), so every screen shows an explicit "not connected" state. The app contains no mock or sample numbers anywhere.

## Non-negotiables
- The app never writes to Supabase: no DDL, migrations, INSERT/UPDATE/DELETE, tables, views, roles, policies or schemas.
- All reporting SQL is version-controlled in `lib/sql/*.sql`. Every query runs inside `BEGIN READ ONLY` (`lib/db/readonly.ts`).
- No customer details (PII) reach the browser:
  - Queries return aggregates only.
  - zod schemas (`lib/types/schemas.ts`) strip any column they don't list.
  - `tests/pii-guard.test.ts` fails the build if a schema or SQL file could expose names, phone numbers, addresses or IDs.
- No secret is ever `NEXT_PUBLIC_*`. The database module imports `server-only`, so browser code can't load it.

## Architecture
| Layer | Location |
|---|---|
| Auth (Google + allow-list, JWT sessions) | `auth.ts`, `lib/auth/*`, `proxy.ts` (first redirect check), `app/(dash)/layout.tsx` (server check) |
| Read-only database access | `lib/db/pool.ts`, `lib/db/readonly.ts`, `lib/db/sql.ts` (only listed SQL files can run) |
| Reporting SQL | `lib/sql/*.sql`: one file per query. Each file's header documents source, grain, parameters and rules. |
| Typed data modules | `lib/data/*.ts`, each returning `DataResult<T>` (`ok` / `empty` / `not_connected` / `error`) |
| Metric definitions | `lib/metrics/definitions.ts` (formula, numerator, denominator, grain, source, status) |
| Pure calculations | `lib/metrics/compute.ts`, `lib/metrics/series.ts` |
| Formatting | `lib/format/inr.ts` (₹, Indian digit grouping, lakh/crore), `lib/format/ist.ts` (Asia/Kolkata dates) |
| UI | `components/*`; pages in `app/(dash)/*` |

Sign-in is checked three times:
1. `proxy.ts` redirects signed-out page requests to `/login` and returns 401 for API calls.
2. The dashboard layout checks again on the server (`requireUser`).
3. Every data function checks again before querying (`assertUser` in `lib/data/run.ts`).

The email allow-list is re-checked on every request, so removing an address from `ALLOWED_EMAILS` revokes access straight away.

## Agreed definitions encoded here
- **New-sales exclusions:** only `PRESCRIPTION_UPLOADED`, `DELIVERY_CANCELED` and `THREE_PL_CANCELLED_ACKNOWLEDGEMENT`.
- **Channel:**
  - APP = self-serve.
  - WEB_AGENT = WEB order placed by a sales agent (`Internal_Team = true`).
  - WEB_OTHER = WEB order not placed by an agent.
- **Fresh/Repeat:** `Order_Type` is the source of truth.
- **Abandoned-cart leads:** the written **crm_025a** rule (`lib/sql/cart_leads_daily.sql`), not the live `crm.cart_leads_std()`.
- **CAC per Fresh order** = Meta spend ÷ (Fresh APP + Fresh WEB orders).
- **Cost per new customer** = Meta spend ÷ distinct `userID`s with a Fresh order.

## Local development
```bash
npm ci
cp .env.example .env.local   # fill in values; keep DATA_ENABLED=false until approved
npm run dev
npm run check                # typecheck + lint + tests + build
```

## Environment variables
All variables are listed in `.env.example`.
- **For sign-in:** `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`.
- **For live data:** `DATA_ENABLED=true` and `DATABASE_URL` (Supabase transaction pooler, port 6543). `DATABASE_CA_CERT` is optional.

Google OAuth redirect URIs:
- Production: `https://<your-domain>/api/auth/callback/google`
- Local development: `http://localhost:3000/api/auth/callback/google`

Vercel functions are pinned to `hnd1` (Tokyo), next to the Supabase project in `ap-northeast-1`.
