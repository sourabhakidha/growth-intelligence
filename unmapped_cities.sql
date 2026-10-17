-- unmapped_cities
-- Sources: public."Order_Level_V4", public.dash_city_region
-- Grain out: normalised city text (Fresh orders with no region mapping)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Output : city text and counts only — the city field, never street/landmark/address fields. Top 50.
select
  coalesce(nullif(lower(trim(o.city)), ''), '(blank)') as city_key,
  count(*)                                             as fresh_orders
from public."Order_Level_V4" o
left join public.dash_city_region r on r.city_key = lower(trim(o.city))
where o."orderDate" >= $1::date
  and o."orderDate" <  ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')
  and r.region is null
group by 1
order by fresh_orders desc, city_key
limit 50;
