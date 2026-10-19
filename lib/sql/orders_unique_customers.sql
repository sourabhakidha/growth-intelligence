-- orders_unique_customers
-- Source : public."Order_Level_V4"   Grain out: order_type (range level)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Purpose: deduplicated customer counts for the whole range. A customer who ordered on APP and WEB counts
--          once in unique_customers_all (audit §4.7) — APP + WEB columns must NOT be summed.
-- Rules  : same exclusions and channel logic as orders_daily.sql.
with o as (
  select
    o."Order_Type" as order_type,
    o."userID" as user_id,
    case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end as channel
  from public."Order_Level_V4" o
  where o."orderDate" >= $1::date
    and o."orderDate" <  ($2::date + 1)
    and o."orderPlatform" in ('APP', 'WEB')
    and o."Order_Type" in ('Fresh', 'Repeat')
    and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')
)
select
  order_type,
  count(distinct user_id)                                      as unique_customers_all,
  count(distinct user_id) filter (where channel = 'APP')       as unique_customers_app,
  count(distinct user_id) filter (where channel = 'WEB')       as unique_customers_web
from o
group by order_type
order by order_type;
