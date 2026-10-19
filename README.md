# Growth Intelligence Dashboard (Akidha)

An internal dashboard for performance marketing and growth. Built with Next.js 16 (App Router, TypeScript), hosted on Netlify, and reading the existing Supabase database **read-only** over Supabase REST (`SUPABASE_URL` + service key, no connection pooler).

> Live data is controlled by `DATA_ENABLED`. When it is `false`, or a source can't be read, the screen shows an explicit "not connected" state. The app contains no mock or sample numbers anywhere.

## Non-negotiables
- The app never writes to Supabase: no DDL, migrations, INSERT/UPDATE/DELETE, tables, views, roles, policies or schemas.
- Every reporting definition is version-controlled in `lib/sql/*.sql` and implemented over Supabase REST in `lib/db/queries.ts`. The Supabase layer (`lib/db/supabase.ts`) only issues SELECTs: no insert/update/delete/rpc, which `tests/pii-guard.test.ts` enforces.
- No customer details (PII) reach the browser:
  - Queries return aggregates only.
  - zod schemas (`lib/types/schemas.ts`) strip any column they don't list.
  - `tests/pii-guard.test.ts` fails the build if a schema or SQL file could expose names, phone numbers, addresses or IDs.
- No secret is ever `NEXT_PUBLIC_*`. The database module imports `server-only`, so browser code can't load it.

## Architecture
| Layer | Location |
|---|---|
| Auth (shared role passwords, JWT sessions) | `auth.ts`, `lib/auth/*`, `app/(dash)/layout.tsx` (server check) |
| Read-only Supabase access | `lib/db/supabase.ts` (service-key client, paged SELECTs), `lib/db/queries.ts` (one implementation per definition), `lib/db/aggregate.ts` (pure helpers), `lib/db/readonly.ts` (zod validation), `lib/db/sql.ts` (registry: only listed queries can run) |
| Reporting definitions | `lib/sql/*.sql`: one file per query. Each file's header documents source, grain, parameters and rules; `lib/db/queries.ts` reproduces it. |
| Typed data modules | `lib/data/*.ts`, each returning `DataResult<T>` (`ok` / `empty` / `not_connected` / `error`) |
| Metric definitions | `lib/metrics/definitions.ts` (formula, numerator, denominator, grain, source, status) |
| Pure calculations | `lib/metrics/compute.ts`, `lib/metrics/series.ts` |
| Formatting | `lib/format/inr.ts` (₹, Indian digit grouping, lakh/crore), `lib/format/ist.ts` (Asia/Kolkata dates) |
| UI | `components/*`; pages in `app/(dash)/*` |

Sign-in is checked twice, both on the server:
1. The dashboard layout redirects signed-out visitors to `/login` (`requireUser`).
2. Every data function checks again before querying (`assertUser` in `lib/data/run.ts`).

There is deliberately no `proxy.ts`/middleware: Netlify would package it as an edge function, which fails to bundle on Windows (Netlify's Next.js adapter mangles the Turbopack chunk path), and it only duplicated the layout check. Any future API route must call `assertUser()` itself.

Sign-in uses one password per role: `DASHBOARD_PASSWORD` (Viewer), `DASHBOARD_PASSWORD_ADMIN` (Admin) and `DASHBOARD_PASSWORD_FINANCE` (Finance). All roles currently see the same pages. Each session stores a fingerprint of its role's password, so changing or removing a password signs out everyone who used it.

## Agreed definitions encoded here
- **New-sales exclusions:** only `PRESCRIPTION_UPLOADED`, `DELIVERY_CANCELED` and `THREE_PL_CANCELLED_ACKNOWLEDGEMENT`.
- **Channel:** APP = self-serve app orders; WEB = sales-assisted orders within the app business (not website-acquired customers). WEB is never split into agent / non-agent.
- **Fresh/Repeat:** `Order_Type` is the source of truth.
- **Regional hierarchy** (`lib/geo/regions.ts`, by pincode, first match wins): Priority Mumbai pincodes (the 200 supplied codes) → Tier 1 (rest of MMR incl. Mira-Bhayandar, Pune & Pimpri-Chinchwad, Kolkata & Howrah, Hyderabad & Secunderabad, Ahmedabad, Chennai, Bangalore, Surat) → Delhi NCR → Tier 2 (Government of India Y-class cities plus Satara, matched on city text + the state's postal circle) → Tier 3 (any other valid pincode). Orders without a valid pincode are "location not verified", never Tier 3, and are never listed by pincode. Surat (high RTO) and Visakhapatnam are highlighted whenever they get orders. Priority pincodes with fewer than 3 distinct customers are merged into one row. Validate the mapping against live orders with `npm run validate:regions` (internal output, not shown on the dashboard).
- **RTO and cancellations (agreed 18 Oct 2026, `lib/geo/aggregate.ts`):** RTO = `RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`, `RETURN_TO_ORIGIN`; RTO rate = RTO ÷ (`COMPLETED` + RTO) among eligible Fresh orders. Cancelled = `DELIVERY_CANCELED`, `THREE_PL_CANCELLED_ACKNOWLEDGEMENT` only (not `DR_REJECTED`, `FAILED` or other statuses); cancellation rate = cancelled ÷ placed Fresh orders (all statuses except `PRESCRIPTION_UPLOADED`). New Sales figures are unchanged.
- **Period view:** end date / previous day / last 7 days / month to date on the Regional page, anchored to the end date of the date filter (`lib/format/periods.ts`). When the end date is today, today is shown "so far" and the 7-day and month-to-date figures use complete days only; orders per day = orders ÷ complete days.
- **App funnel** (`lib/metrics/funnel.ts`, `lib/sql/af_funnel.sql`): AppsFlyer (paid users only, distinct devices over the range, from 6 Oct 2026) and GA4 (all users, daily distinct users summed, ~2-day lag) are shown side by side and never merged. "Payment attempted" is derived (failed or purchased) because neither source has a payment-attempt event. Add-to-cart is split into new vs repeat customers with the agreed cart-lead repeat rule. Tracked purchase events are compared with, never substituted for, eligible Fresh APP orders.
- **Action insights** (`lib/metrics/actionInsights.ts`, shown on Overview and App Funnel): rule-based, each with evidence, causes marked confirmed / hypothesis with confidence, levers, action, impact (arithmetic sensitivities only) and a follow-up metric; tracking problems are separated from performance changes.
- **Abandoned-cart leads:** the written **crm_025a** rule (`lib/sql/cart_leads_daily.sql`), not the live `crm.cart_leads_std()`.
- **CAC per Fresh order** = Meta spend ÷ (Fresh APP + Fresh WEB orders).
- **Cost per new customer** = Meta spend ÷ distinct `userID`s with a Fresh order.

## Local development
```bash
npm ci
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
npm run check                # typecheck + lint + tests + build
```

## Environment variables
All variables are listed in `.env.example`.
- **For sign-in:** `AUTH_SECRET`, `DASHBOARD_PASSWORD`, `DASHBOARD_PASSWORD_ADMIN`, `DASHBOARD_PASSWORD_FINANCE`.
- **For live data:** `DATA_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

### Supabase read access
The service key reads `public`, `crm` and `marketing_meta` out of the box. The Meta ads (`adwatch`) and GA4 funnel (`bigquery_data`) sources show "not connected" until a database admin grants read access:
```sql
grant usage on schema adwatch to service_role;
grant select on adwatch.meta_ad_daily, adwatch.af_ad_daily to service_role;
grant select on bigquery_data.app_funnel_daily to service_role;
```

## Deploying to Netlify
`netlify.toml` sets the build; Netlify detects Next.js and applies its runtime automatically.
1. Create the site: `npx netlify-cli init` (or import the repo in the Netlify UI).
2. Add the variables from `.env.example` in Site configuration → Environment variables (or `npx netlify-cli env:import .env.local`). Mark `SUPABASE_SERVICE_KEY`, `AUTH_SECRET` and the passwords as secret.
3. Set `AUTH_URL` to the production URL (e.g. `https://akidha-growth-dashboard-673.netlify.app`). Without it, Auth.js redirects to the per-deploy URL after sign-in and the session cookie is lost.
4. Deploy: `npx netlify-cli deploy --build --prod`. On Windows, stop any running `next dev`/`next start` first: they lock `.next`, and the Netlify adapter fails with "Failed publishing static content".

Live site: https://akidha-growth-dashboard-673.netlify.app (team "akidhas team"; Netlify team-login protection is off, so the dashboard passwords are the only gate).

The Supabase project is in `ap-northeast-1` (Tokyo). Where your plan allows, set Site configuration → Functions → Region to Tokyo to cut query latency.
