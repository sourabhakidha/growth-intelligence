-- af_events_daily
-- Source : public.af_events_rt (AppsFlyer raw, non-organic only — organic ingest is disabled, audit §5)
-- Grain out: IST event date × event_name × media source group
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Notes  : coverage starts 2026-10-06. media_source 'restricted' = Meta's user-level data restriction; it
--          cannot be broken down by campaign/ad. customer_user_id = Order_Level_V4.userID.
--          Install rows carry appsflyer_id only (no customer_user_id).
select
  (e.event_ts at time zone 'Asia/Kolkata')::date as event_date,
  e.event_name,
  case
    when e.media_source = 'restricted'   then 'restricted'
    when e.media_source = 'Facebook Ads' then 'facebook'
    else 'other_paid'
  end                                         as media_source_group,
  count(*)                                    as events,
  count(distinct e.appsflyer_id)              as unique_devices,
  count(distinct nullif(e.customer_user_id, '')) as unique_users
from public.af_events_rt e
where e.event_ts >= ($1::date::timestamp at time zone 'Asia/Kolkata')
  and e.event_ts <  (($2::date + 1)::timestamp at time zone 'Asia/Kolkata')
  and e.report_type in ('installs_report', 'in_app_events_report')
group by 1, 2, 3
order by 1, 2, 3;
