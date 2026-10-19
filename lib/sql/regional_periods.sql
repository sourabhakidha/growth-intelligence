-- regional_periods
-- Source : public."Order_Level_V4", same base and rules as regional_fresh.sql.
-- Params : $1 = anchor (date, IST) = end date of the date filter; $2 = today (date, IST)
-- Periods: lib/format/periods.ts -> periodSpecs. The anchor day; the day before; last 7 days; month to date.
--          If the anchor is today (still in progress) it is shown as "today so far", and last 7 days / month to date
--          use complete days only (ending yesterday). Otherwise every period ends on the anchor.
--          One read covers the earliest start to the anchor; each period is aggregated separately (total and per tier)
--          in lib/geo/aggregate.ts -> aggregatePeriods, so periods may overlap without double-counting inside a period.
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
where o."orderDate" >= least(date_trunc('month', $1::date)::date, $1::date - 7)
  and o."orderDate" <  ($1::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status <> 'PRESCRIPTION_UPLOADED';
