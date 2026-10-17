-- source_freshness
-- Purpose: latest data date and last load time per audited source, for stale-data banners.
-- Params : none. Each subquery uses an indexed/max-friendly column where available.
select 'orders' as source,
       (select max("orderDate")::date from public."Order_Level_V4") as latest_data_date,
       (select max(synced_at) from public."Order_Level_V4")          as last_loaded_at
union all
select 'meta_ad_daily',
       (select max(date) from adwatch.meta_ad_daily),
       (select max(pulled_at) from adwatch.meta_ad_daily)
union all
select 'meta_campaign_check',
       (select max(reporting_starts) from marketing_meta.meta_campaign_performance_daily),
       (select max(updated_at) from marketing_meta.meta_campaign_performance_daily)
union all
select 'af_events',
       (select (max(event_ts) at time zone 'Asia/Kolkata')::date from public.af_events_rt),
       (select max(synced_at) from public.af_events_rt)
union all
select 'af_ad_daily',
       (select max(date) from adwatch.af_ad_daily),
       (select max(pulled_at) from adwatch.af_ad_daily)
union all
select 'crm_cart_leads',
       (select (max(created_at) at time zone 'Asia/Kolkata')::date from crm.leads where lead_type = 'cart'),
       (select max(created_at) from crm.leads where lead_type = 'cart');
