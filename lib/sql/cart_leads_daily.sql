-- cart_leads_daily
-- THE abandoned-cart ("abd cart") lead count for this dashboard.
-- Rule   : the written crm_025a definition agreed on 14 Oct 2026 (audit §8a). Deliberately NOT the live
--          crm.cart_leads_std(), which crm_027b changed (first-touch merge + "any earlier trace" repeat rule).
--          Do not count leads from cart_realtime, cart_ledger, cart_merge_view or Metabase.
--   1. crm.leads with lead_type = 'cart' (only carts that passed CRM rules become leads)
--   2. exclude recycled re-runs (source_ref contains '#r') and context->>'closed_why' = 'duplicate_merged'
--   3. date = created_at in Asia/Kolkata; one lead per phone per IST date; lead time = earliest created_at that day
--   4. Repeat = phone has a COMPLETED order in Order_Level_V4 with orderDate (IST) before the lead time; else Fresh
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- Output : counts only. Phone is used for de-duplication and matching inside this query and never returned.
-- Check  : 13 Oct 2026 = 257 total (174 fresh / 83 repeat as of 17 Oct; labels move as orders complete).
with base as (
  select l.id, l.phone, l.created_at, (l.created_at at time zone 'Asia/Kolkata')::date as d
  from crm.leads l
  where l.lead_type = 'cart'
    and l.created_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')
    and l.created_at <  (($2::date + 1)::timestamp at time zone 'Asia/Kolkata')
    and coalesce(l.source_ref, '') not like '%#r%'
    and l.context->>'closed_why' is distinct from 'duplicate_merged'
),
m as (
  select distinct on (phone, d) id, phone, d, created_at
  from base
  order by phone, d, created_at, id
),
fo as (
  select o."cxPhone" as ph, min(o."orderDate" at time zone 'Asia/Kolkata') as first_completed_at
  from public."Order_Level_V4" o
  where o.status = 'COMPLETED'
    and o."cxPhone" in (select phone from m)
  group by o."cxPhone"
),
x as (
  select m.d, (fo.first_completed_at is not null and fo.first_completed_at < m.created_at) as is_repeat
  from m
  left join fo on fo.ph = m.phone
)
select
  d                                     as lead_date,
  count(*)                              as total_cart_leads,
  count(*) filter (where not is_repeat) as fresh,
  count(*) filter (where is_repeat)     as repeat
from x
group by d
order by d;
