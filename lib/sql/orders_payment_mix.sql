-- orders_payment_mix
-- Source : public."Order_Level_V4"   Grain out: channel × payment_mode (Fresh orders only)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Rules  : same exclusions and channel logic as orders_daily.sql.
select
  case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end as channel,
  coalesce(nullif(upper(trim(o."paymentMode")), ''), 'UNKNOWN') as payment_mode,
  count(*)                                    as orders,
  coalesce(sum(o."finalAmount"), 0)           as revenue
from public."Order_Level_V4" o
where o."orderDate" >= $1::date
  and o."orderDate" <  ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')
group by 1, 2
order by 1, orders desc;
