-- regional_fresh
-- Source : public."Order_Level_V4"   Grain in: 1 row per orderID (primary key)
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Base   : Fresh orders PLACED in the range: Order_Type 'Fresh', orderPlatform APP (self-serve) or WEB (sales-assisted,
--          never split by agent), every status except PRESCRIPTION_UPLOADED (prescription upload only, no order).
-- Rules  : New-sales figures (orders, customers, revenue, AOV, APP/WEB, RTO, delivered) use eligible_new_sale only,
--          i.e. exactly the three agreed exclusions below. Cancellations are counted on the placed base, because most
--          cancelled statuses are new-sales exclusions. Agreed status sets (18 Oct 2026), in lib/geo/aggregate.ts:
--            cancelled = DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT only (not DR_REJECTED, FAILED, others)
--            RTO       = RTO_INITIATED, RTO_IN_TRANSIT, RTO_DELIVERED, RETURN_TO_ORIGIN;  delivered = COMPLETED
--          RTO rate = RTO / (delivered + RTO); cancellation rate = cancelled / placed.
-- Output : location resolution (pincode -> tier -> area) and aggregation run in lib/geo/regions.ts and
--          lib/geo/aggregate.ts (lib/db/queries.ts -> regionalFresh). Only aggregates leave the server; userID and
--          pinCode are never returned per order, and priority pincodes with < 3 distinct customers are merged.
select
  o."orderID"                                                        as order_id,
  o."orderDate"::date                                                as order_date,
  case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end      as channel,
  o."userID"                                                         as user_id,
  o."finalAmount"                                                    as amount,
  o."pinCode"                                                        as pin_code,
  o.city,
  o.status,
  (o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')) as eligible_new_sale
from public."Order_Level_V4" o
where o."orderDate" >= $1::date
  and o."orderDate" <  ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status <> 'PRESCRIPTION_UPLOADED';
