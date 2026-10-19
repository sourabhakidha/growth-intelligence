-- af_funnel_windows
-- Same definition as af_funnel.sql, computed for several named windows at once (the App funnel period table:
-- today / yesterday / last 7 days / MTD / selected range and their comparisons) from ONE read of their combined span.
-- Params : $1 = text[] of window specs "id:from:to" (IST dates, inclusive)
-- Grain out: window × funnel stage. Distinct devices / users are counted within each window, never summed across windows.
-- The new vs repeat add-to-cart split (atc_new_customer / atc_repeat_customer) follows af_funnel.sql per window; the
-- earliest COMPLETED order per user does not depend on the window, so it is looked up once.
-- Output : window id, stage name and counts only. No appsflyer_id, customer_user_id or order IDs leave the server.
with w as (
  select split_part(s, ':', 1) as id, split_part(s, ':', 2)::date as from_date, split_part(s, ':', 3)::date as to_date
  from unnest($1::text[]) as s
),
e as (
  select e.event_name, e.appsflyer_id, nullif(e.customer_user_id, '') as user_id, (e.event_ts at time zone 'Asia/Kolkata')::date as event_date
  from public.af_events_rt e
  where e.report_type in ('installs_report', 'in_app_events_report')
    and e.event_ts >= ((select min(from_date) from w)::timestamp at time zone 'Asia/Kolkata')
    and e.event_ts <  (((select max(to_date) from w) + 1)::timestamp at time zone 'Asia/Kolkata')
)
select w.id as window, e.event_name as stage, count(*) as events, count(distinct e.appsflyer_id) as devices, count(distinct e.user_id) as users
from w
join e on e.event_date between w.from_date and w.to_date
group by w.id, e.event_name;
