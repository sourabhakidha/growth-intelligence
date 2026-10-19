-- meta_af
-- Source : public.af_events_rt (AppsFlyer raw, paid users only; coverage from 2026-10-06)
-- Params : $1 = from, $2 = to (dates, IST, inclusive) for the daily series; further params are named windows
--          "id:from:to" for which DISTINCT devices are counted over the whole window (never daily counts summed);
--          optional "st:<today>:<minute>" adds level "st" rows: each day from the earlier of today − 7 and the 1st of the
--          month (not before 2026-10-07, AppsFlyer's first whole day) to today, counting only events and orders by that IST minute of the day.
-- Scope  : Meta-attributed devices only: media_source 'restricted' (Meta's user-level restriction) or 'Facebook Ads'.
--          installs = installs_report rows; atc = devices firing af_add_to_cart.
--          atc_fresh / checkout_fresh = USERS whose first add-to-cart / af_initiated_checkout in the window comes before
--          any COMPLETED order in Order_Level_V4 (the agreed cart-lead repeat rule; otherwise repeat).
--          fresh_orders = eligible Fresh orders (the three agreed exclusions, APP + WEB; fresh_orders_app = APP only) in
--          the window placed by users with a Meta-attributed in-app event in the same window; fresh_customers = distinct
--          such users; atc_fresh_buyers = atc_fresh users who placed such an order (a subset of atc_fresh).
--          This is an AppsFlyer user match to actual orders, NOT Meta purchase attribution.
--          (Implemented in lib/db/queries.ts -> metaAf; the SQL below shows the device counts.)
-- Notes  : Meta itself receives no add-to-cart events; this is the AppsFlyer view of Meta-attributed users at account
--          level. Campaign / ad cannot be resolved for 'restricted' rows, so there is no ad-level add-to-cart.
with e as (
  select (e.event_ts at time zone 'Asia/Kolkata')::date as d, e.event_name, e.appsflyer_id
  from public.af_events_rt e
  where e.media_source in ('restricted', 'Facebook Ads')
    and e.event_name in ('install', 'af_add_to_cart')
    and e.event_ts >= ($1::date::timestamp at time zone 'Asia/Kolkata')
    and e.event_ts <  (($2::date + 1)::timestamp at time zone 'Asia/Kolkata')
)
select d as key,
       count(distinct appsflyer_id) filter (where event_name = 'install')        as installs,
       count(distinct appsflyer_id) filter (where event_name = 'af_add_to_cart') as atc
from e
group by d
order by d;
