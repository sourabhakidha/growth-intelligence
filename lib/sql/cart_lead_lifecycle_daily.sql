-- cart_lead_lifecycle_daily
-- Sources: crm.leads (written crm_025a lead set, as cart_leads_daily.sql), crm.tasks, crm.cart_ledger,
--          public."Order_Level_V4"
-- Grain out: IST lead date
-- Params : $1 = from (date, IST), $2 = to (date, IST, inclusive)
-- PROVISIONAL (audit §4.3–4.4): a task is per phone and can span several leads, so with_task / dialled /
--          won_* are task-level signals, not a final recovery attribution. won_* counts the task's won order
--          only if it was placed at or after the lead time. The recovery attribution rule (lead types, window,
--          contact-before-order) is still to be agreed; until then the UI labels these figures provisional.
-- Output : counts and a median only. No phone, no order IDs.
with base as (
  select l.id, l.phone, l.task_id, l.created_at, (l.created_at at time zone 'Asia/Kolkata')::date as d
  from crm.leads l
  where l.lead_type = 'cart'
    and l.created_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')
    and l.created_at <  (($2::date + 1)::timestamp at time zone 'Asia/Kolkata')
    and coalesce(l.source_ref, '') not like '%#r%'
    and l.context->>'closed_why' is distinct from 'duplicate_merged'
),
m as (
  select distinct on (phone, d) id, task_id, d, created_at
  from base
  order by phone, d, created_at, id
),
ledger as (
  select cl.lead_id, min(cl.cart_ts) as cart_ts
  from crm.cart_ledger cl
  where cl.lead_id in (select id from m)
  group by cl.lead_id
),
j as (
  select
    m.d,
    m.id,
    t.id is not null                                  as has_task,
    coalesce(t.attempts, 0) > 0                       as dialled,
    o."orderID" is not null                           as won_any,
    case
      when o."orderID" is null then null
      when o."orderPlatform" = 'APP' then 'APP'
      else 'WEB'
    end                                               as won_channel,
    o."Order_Type"                                    as won_type,
    extract(epoch from (m.created_at - lg.cart_ts)) / 60.0 as min_cart_to_lead
  from m
  left join crm.tasks t on t.id = m.task_id
  left join public."Order_Level_V4" o
         on o."orderID" = t.won_order_id
        and (o."orderDate" at time zone 'Asia/Kolkata') >= m.created_at
  left join ledger lg on lg.lead_id = m.id
)
select
  d                                                                    as lead_date,
  count(*)                                                             as leads,
  count(*) filter (where has_task)                                     as with_task,
  count(*) filter (where dialled)                                      as dialled,
  count(*) filter (where won_any)                                      as won_any_order,
  count(*) filter (where won_type = 'Fresh' and won_channel = 'APP')       as won_fresh_app,
  count(*) filter (where won_type = 'Fresh' and won_channel = 'WEB')       as won_fresh_web,
  round((percentile_cont(0.5) within group (order by min_cart_to_lead))::numeric, 1) as median_min_cart_to_lead
from j
group by d
order by d;
