import { ReqContext } from "back-end/types/request";

export const EVENTS_FORWARDER_FEATURE_ID = "events-forwarder";

export function isConfluentEventForwarderSinkType(
  sinkType?: "bigquery" | "snowflake" | "databricks" | string | null,
): boolean {
  return sinkType === "bigquery" || sinkType === "snowflake";
}

export async function isEventsForwarderFeatureOn(
  context: ReqContext,
): Promise<boolean> {
  // TODO: Remove — restore license gate before merging:
  // import { orgHasPremiumFeature } from "back-end/src/enterprise";
  // return orgHasPremiumFeature(context.org, EVENTS_FORWARDER_FEATURE_ID);
  void context;
  return true;
}

export async function requireEventsForwarderFeature(
  context: ReqContext,
): Promise<void> {
  if (!(await isEventsForwarderFeatureOn(context))) {
    context.throwPlanDoesNotAllowError(
      "Event Forwarder is not enabled for this organization.",
    );
  }
}
