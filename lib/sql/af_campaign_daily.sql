-- af_campaign_daily
-- Source : adwatch.af_campaign_daily (AppsFlyer aggregate pull by campaign)   Grain out: date × campaign
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Scope  : media_source 'Facebook Ads' only. Campaign names match adwatch.meta_ad_daily.campaign_name.
-- Notes  : atc_users = AppsFlyer add-to-cart users of ALL customers (no Fresh split at campaign level);
--          first_purchasers = AppsFlyer first-purchase users. Both are AppsFlyer attribution, NOT Fresh orders and not
--          Meta-reported purchases. Coverage from 1 Sep 2026.
select
  a.date,
  coalesce(a.campaign, 'None')        as campaign_name,
  coalesce(sum(a.installs), 0)        as installs,
  coalesce(sum(a.atc_users), 0)       as atc_users,
  coalesce(sum(a.purchasers), 0)      as purchasers,
  coalesce(sum(a.first_purchasers), 0) as first_purchasers
from adwatch.af_campaign_daily a
where a.date between $1::date and $2::date
  and a.media_source = 'Facebook Ads'
group by a.date, coalesce(a.campaign, 'None')
order by a.date, campaign_name;
