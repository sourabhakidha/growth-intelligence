-- meta_spend_check
-- Sources: adwatch.meta_ad_daily vs marketing_meta.meta_campaign_performance_daily   Grain out: date
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Purpose: reconciliation. Differences of a few hundred rupees on recent days are Meta late restatements
--          (audit §2); larger gaps should raise a data-quality flag.
with a as (
  select date, sum(spend) as spend, sum(impressions) as impressions
  from adwatch.meta_ad_daily
  where date between $1::date and $2::date
  group by date
),
c as (
  select reporting_starts as date, sum(amount_spent_inr) as spend, sum(impressions) as impressions
  from marketing_meta.meta_campaign_performance_daily
  where reporting_starts between $1::date and $2::date
  group by reporting_starts
)
select
  coalesce(a.date, c.date) as date,
  a.spend                  as adwatch_spend,
  c.spend                  as campaign_table_spend,
  a.impressions            as adwatch_impressions,
  c.impressions            as campaign_table_impressions
from a
full join c on c.date = a.date
order by 1;
