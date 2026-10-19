// Period comparison anchored to the end date of the date filter. Pure (only ./ist.ts), shared by the query layer
// and the page so both use exactly the same dates.
//
// When the end date is today, today is still in progress: it is shown as "Today so far" with no per-day average, and
// "Last 7 days" / "Month to date" use complete days only (ending yesterday), so a few hours of today never drag the
// averages down. When the end date is in the past, every period ends on that date.

import { addDays, daysBetween, formatDateShort, monthStart } from "./ist.ts";

export type PeriodId = "day" | "prev_day" | "last7" | "mtd";

export interface PeriodSpec {
  id: PeriodId;
  label: string;
  from: string;
  to: string;
  /** Complete days in the period (0 for today-so-far, or an empty month-to-date on the 1st). */
  days: number;
  /** True for today while it is still in progress. */
  partial: boolean;
}

export function periodSpecs(anchor: string, today: string): PeriodSpec[] {
  const complete = anchor < today;
  const prev = addDays(anchor, -1);
  const end = complete ? anchor : prev; // last complete day
  const mtdFrom = monthStart(anchor);
  const mtdDays = mtdFrom <= end ? daysBetween(mtdFrom, end) : 0;
  const span = (from: string, to: string) => (from === to ? formatDateShort(from) : `${formatDateShort(from)} – ${formatDateShort(to)}`);
  return [
    {
      id: "day",
      label: complete ? `${formatDateShort(anchor)} (end date)` : `Today so far (${formatDateShort(anchor)})`,
      from: anchor,
      to: anchor,
      days: complete ? 1 : 0,
      partial: !complete,
    },
    {
      id: "prev_day",
      label: complete ? `${formatDateShort(prev)} (previous day)` : `Yesterday (${formatDateShort(prev)})`,
      from: prev,
      to: prev,
      days: 1,
      partial: false,
    },
    { id: "last7", label: `Last 7 days (${span(addDays(end, -6), end)})`, from: addDays(end, -6), to: end, days: 7, partial: false },
    {
      id: "mtd",
      label: mtdDays ? `Month to date (${span(mtdFrom, end)})` : "Month to date (no complete days yet)",
      from: mtdFrom,
      to: mtdDays ? end : addDays(mtdFrom, -1), // empty range when there are no complete days
      days: mtdDays,
      partial: false,
    },
  ];
}
