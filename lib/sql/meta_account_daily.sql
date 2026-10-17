-- meta_account_daily
-- Source : adwatch.meta_ad_daily   Grain out: date (account total)
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Notes  : Account-level spend for CAC numerators. Reach is not additive across ads and is omitted here.
select
  m.date,
  coalesce(sum(m.spend), 0)       as spend,
  coalesce(sum(m.impressions), 0) as impressions,
  coalesce(sum(m.clicks), 0)      as clicks,
  coalesce(sum(m.link_clicks), 0) as link_clicks,
  coalesce(sum(m.installs), 0)    as installs
from adwatch.meta_ad_daily m
where m.date between $1::date and $2::date
group by m.date
order by m.date;
