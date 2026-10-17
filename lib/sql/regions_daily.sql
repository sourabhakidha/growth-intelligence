-- regions_daily
-- Sources: public."Order_Level_V4", public.dash_city_region (city_key → region)
-- Grain out: IST date × region × channel (Fresh orders only)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Notes  : city is matched on lower(trim(city)). Cities without a mapping are reported as 'Unmapped' so regional
--          totals always reconcile to total Fresh orders. Tier 3 has no definition yet (audit §9) — do not infer it.
--          Same exclusions and channel logic as orders_daily.sql.
select
  o."orderDate"::date                    as order_date,
  coalesce(r.region, 'Unmapped')         as region,
  case
    when o."orderPlatform" = 'APP' then 'APP'
    when o."orderPlatform" = 'WEB' and o."Internal_Team" is true then 'WEB_AGENT'
    else 'WEB_OTHER'
  end                                    as channel,
  count(*)                               as fresh_orders,
  coalesce(sum(o."finalAmount"), 0)      as fresh_revenue,
  coalesce(sum(o."finalAmount") filter (where o.status = 'COMPLETED'), 0) as completed_fresh_revenue
from public."Order_Level_V4" o
left join public.dash_city_region r on r.city_key = lower(trim(o.city))
where o."orderDate" >= $1::date
  and o."orderDate" <  ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')
group by 1, 2, 3
order by 1, 2, 3;
