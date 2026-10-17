-- meta_ad_daily
-- Source : adwatch.meta_ad_daily (hourly adwatch-collect)   Grain: date × ad_id (verified unique, audit §2)
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Notes  : date is Meta's account-day. Coverage starts 2026-09-12; earlier history lives in the stale
--          "Meta_AdSpent" schema and is NOT merged here. installs = Meta-reported mobile_app_install.
--          purchases/purchase_value are always 0 (Meta receives no purchase events) and are not selected.
select
  m.date,
  m.campaign_id,
  m.campaign_name,
  m.adset_id,
  m.adset_name,
  m.ad_id,
  m.ad_name,
  coalesce(m.spend, 0)       as spend,
  coalesce(m.impressions, 0) as impressions,
  coalesce(m.reach, 0)       as reach,
  coalesce(m.clicks, 0)      as clicks,
  coalesce(m.link_clicks, 0) as link_clicks,
  coalesce(m.installs, 0)    as installs
from adwatch.meta_ad_daily m
where m.date between $1::date and $2::date
order by m.date, m.campaign_id, m.adset_id, m.ad_id;
