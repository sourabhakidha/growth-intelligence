-- change_log
-- Source : crm.change_log (the shared change / experiment log — CRM and Performance Marketing log changes here)
-- Params : $1 = from (date), $2 = to (date, inclusive) — changes whose start_date falls in the range, plus changes that
--          started earlier and are still open (no closed_at) or under review in the range, so they can be flagged as
--          concurrent changes (confounders) for anything detected in the range.
-- Output : the log entry as written by its owner. owner / created_by are team members, not customers.
select
  c.id, c.title, c.type, c.owner, c.created_by, c.hypothesis, c.scope::text as scope,
  c.start_date, c.review_date, c.status, c.primary_metric, c.target_value, c.target_dir,
  c.verdict, c.decision, c.closed_at
from crm.change_log c
where c.start_date <= $2::date
  and (c.start_date >= $1::date or c.closed_at is null or c.closed_at::date >= $1::date)
order by c.start_date, c.id;
