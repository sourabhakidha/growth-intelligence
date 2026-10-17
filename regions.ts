import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { RegionDailyRow, UnmappedCityRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** Fresh orders by mapped region (public.dash_city_region), with 'Unmapped' so totals reconcile. */
export function getRegionsDaily(range: DateRange) {
  return runSource("regions", "regions_daily", rangeParams(range), RegionDailyRow);
}

/** Top cities with no region mapping — to drive mapping work. */
export function getUnmappedCities(range: DateRange) {
  return runSource("regions", "unmapped_cities", rangeParams(range), UnmappedCityRow);
}
