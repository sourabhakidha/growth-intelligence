-- app_funnel_daily
-- Source : bigquery_data.app_funnel_daily (foreign table → GA4/Firebase export, all users incl. organic)
-- Grain  : day × platform; each step is DISTINCT USERS who fired the event that day (not a cohort).
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Notes  : `day` is text in YYYYMMDD form — compare as YYYYMMDD strings, never against 'YYYY-MM-DD'
--          (lexical comparison with dashes silently returns every row). Data lags ~2 days.
select
  to_date(f.day, 'YYYYMMDD') as day,
  f.platform,
  coalesce(f.first_open, 0)     as first_open,
  coalesce(f.active_users, 0)   as active_users,
  coalesce(f.searched, 0)       as searched,
  coalesce(f.viewed_item, 0)    as viewed_item,
  coalesce(f.added_to_cart, 0)  as added_to_cart,
  coalesce(f.viewed_cart, 0)    as viewed_cart,
  coalesce(f.began_checkout, 0) as began_checkout,
  coalesce(f.purchased, 0)      as purchased,
  coalesce(f.first_purchase, 0) as first_purchase
from bigquery_data.app_funnel_daily f
where f.day between to_char($1::date, 'YYYYMMDD') and to_char($2::date, 'YYYYMMDD')
order by 1, 2;
