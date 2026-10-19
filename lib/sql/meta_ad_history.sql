-- meta_ad_history
-- Source : adwatch.meta_ad_daily (hourly adwatch-collect)   Grain: date × ad_id (verified unique)
-- Params : $1 = to (date, inclusive). Reads from the start of adwatch coverage (2026-09-12).
-- Purpose: one small read for the Meta Ads page: period comparisons (today / yesterday / last 7 days / MTD vs the
--          equivalent elapsed days of last month), daily trends, creative baselines and each ad's first delivery date
--          (an INFERRED launch date — the business-supplied launch list overrides it when provided).
-- Notes  : video_3s > 0 marks a video creative (inferred format; no creative-type field is stored). reach and frequency
--          are per ad-day and NOT additive across ads or days — never summed into account reach.
--          No purchase or add-to-cart events reach Meta, so none are selected.
select
  m.date, m.campaign_id, m.campaign_name, m.adset_id, m.adset_name, m.ad_id, m.ad_name,
  coalesce(m.spend, 0) as spend, coalesce(m.impressions, 0) as impressions, coalesce(m.reach, 0) as reach,
  coalesce(m.frequency, 0) as frequency, coalesce(m.clicks, 0) as clicks, coalesce(m.link_clicks, 0) as link_clicks,
  coalesce(m.installs, 0) as installs, coalesce(m.video_3s, 0) as video_3s, coalesce(m.thruplays, 0) as thruplays
from adwatch.meta_ad_daily m
where m.date between '2026-09-12'::date and $1::date
order by m.date, m.ad_id;
