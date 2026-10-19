-- orders_daily
-- Source : public."Order_Level_V4"   Grain in: 1 row per orderID   Grain out: IST date × channel × order_type
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Rules  : orderDate is stored as IST wall-clock time (timestamp without time zone), so ::date is the IST date.
--          New-sales exclusions (audit §4.6, confirmed by owner): PRESCRIPTION_UPLOADED, DELIVERY_CANCELED,
--          THREE_PL_CANCELLED_ACKNOWLEDGEMENT. No other status is excluded.
--          Channel: APP = orderPlatform 'APP' (self-serve app orders); WEB = orderPlatform 'WEB' (sales-assisted orders
--          within the app business — not website-acquired customers). WEB is never split into agent / non-agent.
--          Order_Type is the source of truth for Fresh/Repeat (audit §4.5).
-- Output : no PII. unique_customers is distinct within the output row only; never sum it across rows.
with o as (
  select
    o."orderDate"::date as order_date,
    case when o."orderPlatform" = 'APP' then 'APP' else 'WEB' end as channel,
    o."Order_Type" as order_type,
    o."userID" as user_id,
    o."finalAmount" as amount,
    o.status,
    o."patient_Age" as patient_age
  from public."Order_Level_V4" o
  where o."orderDate" >= $1::date
    and o."orderDate" <  ($2::date + 1)
    and o."orderPlatform" in ('APP', 'WEB')
    and o."Order_Type" in ('Fresh', 'Repeat')
    and o.status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')
)
select
  order_date,
  channel,
  order_type,
  count(*)                                                    as orders,
  count(distinct user_id)                                     as unique_customers,
  coalesce(sum(amount), 0)                                    as revenue,
  count(*) filter (where status = 'COMPLETED')                as completed_orders,
  coalesce(sum(amount) filter (where status = 'COMPLETED'), 0) as completed_revenue,
  round(avg(patient_age) filter (where patient_age between 1 and 110), 1) as avg_patient_age
from o
group by order_date, channel, order_type
order by order_date, channel, order_type;
