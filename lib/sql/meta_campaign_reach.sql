-- meta_campaign_reach
-- Source : marketing_meta.meta_campaign_performance_daily (daily Meta export, date × campaign; ~1 day behind)
-- Params : $1 = from (date), $2 = to (date, inclusive)
-- Purpose: reach for the change-impact page. adwatch reach is per ad-day; this is Meta's own campaign-day reach.
-- Notes  : reach is NOT additive. Summed across campaigns it double-counts people reached by more than one campaign,
--          and summed across days it double-counts repeat reach — the page shows it as "average daily campaign reach".
select r.reporting_starts as date, r.campaign_id, coalesce(r.reach, 0) as reach
from marketing_meta.meta_campaign_performance_daily r
where r.reporting_starts between $1::date and $2::date
order by 1, 2;
