// Every data-access function returns one of these states. Pages render each state explicitly,
// so "no data" can never be mistaken for "zero".

export type SourceId =
  | "orders"
  | "meta_ad_daily"
  | "meta_campaign_check"
  | "af_events"
  | "af_ad_daily"
  | "ga4_app_funnel"
  | "crm_cart_leads"
  | "crm_lifecycle"
  | "regions"
  | "crm_change_log";

export type DataResult<T> =
  | { state: "ok"; data: T; source: SourceId; fetchedAt: string }
  | { state: "empty"; source: SourceId; fetchedAt: string; reason: string }
  | { state: "not_connected"; source: SourceId; reason: string }
  | { state: "error"; source: SourceId; message: string };

export function isOk<T>(r: DataResult<T>): r is Extract<DataResult<T>, { state: "ok" }> {
  return r.state === "ok";
}
