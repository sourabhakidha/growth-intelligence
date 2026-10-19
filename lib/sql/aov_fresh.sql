-- aov_fresh
-- Source : public."Order_Level_V4"   Grain in: 1 row per orderID   Grain out: IST date × channel × payment mode × region × AOV bracket
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Rules  : eligible Fresh orders — same base as orders_daily.sql: Order_Type 'Fresh', orderPlatform APP / WEB, excluding
--          PRESCRIPTION_UPLOADED, DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT. One row per orderID.
--          AOV = Σ finalAmount ÷ eligible Fresh orders (orders with no amount count as orders with ₹0, as in orders_daily).
--          Payment mode = upper(trim(paymentMode)), blank → UNKNOWN (as orders_payment_mix.sql).
--          Region = lib/geo/regions.ts resolveLocation(pinCode, city): Priority Mumbai pincodes → Tier 1 → Delhi NCR →
--          Tier 2 → Tier 3 → location not verified (resolved in lib/db/queries.ts -> aovFresh, not in SQL).
--          Brackets (lower bound inclusive, upper exclusive, so every order lands in exactly one):
--            b0_100 [0, 100) · b100_200 [100, 200) · b200_500 [200, 500) · b500_600 [500, 600) · b600_plus [600, ∞)
--            no_amount = finalAmount missing (kept visible rather than silently placed in ₹0–100).
-- Output : counts and sums only; no orderID, userID or pinCode leaves the server.
select
  o."orderDate"::date                                                as order_date,
  case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end      as channel,
  coalesce(nullif(upper(trim(o."paymentMode")), ''), 'UNKNOWN')      as payment_mode,
  o."pinCode"                                                        as pin_code,
  o.city,
  case
    when o."finalAmount" is null then 'no_amount'
    when o."finalAmount" < 100  then 'b0_100'
    when o."finalAmount" < 200  then 'b100_200'
    when o."finalAmount" < 500  then 'b200_500'
    when o."finalAmount" < 600  then 'b500_600'
    else 'b600_plus'
  end                                                                as bracket,
  o."finalAmount"                                                    as amount
from public."Order_Level_V4" o
where o."orderDate" >= $1::date
  and o."orderDate" <  ($2::date + 1)
  and o."orderPlatform" in ('APP', 'WEB')
  and o."Order_Type" = 'Fresh'
  and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT');
