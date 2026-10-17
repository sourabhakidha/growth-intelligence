-- af_ad_daily
-- Source : adwatch.af_ad_daily (AppsFlyer aggregate by ad NAME)   Grain out: date × ad_name
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Notes  : joins to Meta by ad_name, not ad_id (audit §3). One ad name can span several ad_ids, so this is a
--          creative-concept level figure. purchasers = AppsFlyer-attributed purchasers, not Fresh orders.
select
  a.date,
  a.ad          as ad_name,
  coalesce(sum(a.installs), 0)   as installs,
  coalesce(sum(a.purchasers), 0) as purchasers
from adwatch.af_ad_daily a
where a.date between $1::date and $2::date
  and a.ad is not null
group by a.date, a.ad
order by a.date, a.ad;
