import { orgRequiresAnyReview, PermissionError } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

// Attaching a schedule to a live rule, or changing an attached schedule's plan,
// lands rule changes without a reviewed revision. Once the org requires review
// anywhere, those operations are reserved for callers who may bypass approval;
// everyone else stages the plan on a draft (PUT
// /features/:id/revisions/:version/rules/:ruleId/ramp-schedule) and publishes
// it, where the plan is reviewed like any other rule change. Lifecycle actions
// (start, pause, advance, rollback, ...) run the reviewed plan and are not
// gated here.
export function assertRampPlanChangeAllowed(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  restApiBypass = false,
): void {
  if (
    !orgRequiresAnyReview(
      context.org.settings,
      context.hasPremiumFeature("require-approvals"),
    )
  ) {
    return;
  }
  if (
    restApiBypass ||
    context.permissions.canBypassFlagApprovalChecks(feature, "feature")
  ) {
    return;
  }
  throw new PermissionError(
    "This organization requires review for feature changes, so a ramp schedule can only be attached to a live rule or re-planned through a draft revision: " +
      `stage it with PUT /api/v2/features/${feature.id}/revisions/{version}/rules/{ruleId}/ramp-schedule and publish, ` +
      "or use credentials with Bypass draft approvals access.",
  );
}

// Fields on a schedule update that change what the scheduler will apply.
export function changesRampPlan(body: Record<string, unknown>): boolean {
  return [
    "steps",
    "startActions",
    "endActions",
    "startDate",
    "cutoffDate",
  ].some((field) => body[field] !== undefined && body[field] !== null);
}
