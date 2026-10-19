-- regional_new_markets
-- Source : public."Order_Level_V4", same base as regional_fresh.sql, over the FULL history up to $2 (starts 25 Oct 2025).
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Rules  : Eligible Fresh orders only (the three agreed new-sales exclusions). A pincode / area is "new" on the date of
--          its first-ever eligible Fresh order. Areas follow lib/geo/regions.ts (Tier 3 = 3-digit postal district).
-- Output : lib/geo/aggregate.ts -> aggregateNewMarkets: per day and tier, new pincodes / new areas and the orders
--          they placed; per tier over the range, active and ever-ordered pincode counts; one row per new area. No
--          pincode, userID or orderID leaves the server.
select
  o."orderID"                                                        as order_id,
  o."orderDate"::date                                                as order_date,
  case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end      as channel,
  o."userID"                                                         as user_id,
  o."finalAmount"                                                    as amount,
  o."pinCode"                                                        as pin_code,
  o.city,
  o.status
from public."Order_Level_V4" o
where o."orderDate" < ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT');
