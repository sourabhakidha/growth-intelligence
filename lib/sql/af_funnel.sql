-- af_funnel
-- Source : public.af_events_rt (AppsFlyer raw, NON-ORGANIC / paid users only — organic ingest is disabled),
--          public."Order_Level_V4" (COMPLETED orders, only to split add-to-cart into new vs repeat customers)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Grain out: funnel stage (range level). Each stage counts DISTINCT devices (appsflyer_id) and DISTINCT users
--          (customer_user_id) over the whole range — never daily distinct counts summed across days.
-- Stages : install (installs_report) → af_search → af_add_to_cart → af_initiated_checkout →
--          payment_attempted (DERIVED: devices with Payment_failed OR af_purchase; AppsFlyer has no payment-attempt
--          event) → Payment_failed / af_purchase → First_Purchase. Micro-events: OTP_sent_success, OTP_verified,
--          af_complete_registration, af_view_content, Cart_View.
-- ATC split (users): repeat = the user has a COMPLETED order (orderDate, IST) before their first add-to-cart in the
--          range — the same repeat rule as the agreed cart-lead definition; new = otherwise; unidentified = add-to-cart
--          events without customer_user_id.
-- Output : stage name and counts only. No appsflyer_id, customer_user_id or order IDs leave the server.
with e as (
  select e.event_name, e.appsflyer_id, nullif(e.customer_user_id, '') as user_id, e.event_ts
  from public.af_events_rt e
  where e.event_ts >= ($1::date::timestamp at time zone 'Asia/Kolkata')
    and e.event_ts <  (($2::date + 1)::timestamp at time zone 'Asia/Kolkata')
    and e.report_type in ('installs_report', 'in_app_events_report')
)
select event_name as stage, count(*) as events, count(distinct appsflyer_id) as devices, count(distinct user_id) as users
from e
group by event_name;
