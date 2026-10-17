import "server-only";

import { SourceFreshnessRow } from "@/lib/types/schemas";
import { runSource } from "./run";

/** Latest data date and last load time per source, for stale-data banners. */
export function getSourceFreshness() {
  return runSource("orders", "source_freshness", [], SourceFreshnessRow);
}
