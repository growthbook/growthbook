import { orgRequiresAnyReview, PermissionError } from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { RampScheduleInterface } from "shared/validators";
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
  if (!reviewIsOn(context)) return;
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

// A schedule can target rules on several features, and bypass authority is
// project-scoped, so re-planning an attached schedule needs it on every
// targeted feature, not just the anchor.
export async function assertRampScheduleReplanAllowed(
  context: ReqContext | ApiReqContext,
  schedule: Pick<RampScheduleInterface, "entityId" | "targets">,
  restApiBypass = false,
): Promise<void> {
  if (!reviewIsOn(context)) return;
  const ids = [
    ...new Set([schedule.entityId, ...schedule.targets.map((t) => t.entityId)]),
  ];
  // Lazy: FeatureModel reaches the ramp model through the services layer.
  const { getAllFeatures } = await import("back-end/src/models/FeatureModel");
  for (const feature of await getAllFeatures(context, { ids })) {
    assertRampPlanChangeAllowed(context, feature, restApiBypass);
  }
}

function reviewIsOn(context: ReqContext | ApiReqContext): boolean {
  return orgRequiresAnyReview(
    context.org.settings,
    context.hasPremiumFeature("require-approvals"),
  );
}

// Fields on a schedule update that change what the scheduler will apply.
// Clearing a date (`null`) counts: it removes a reviewed start or cutoff.
export function changesRampPlan(body: Record<string, unknown>): boolean {
  return [
    "steps",
    "startActions",
    "endActions",
    "startDate",
    "cutoffDate",
  ].some((field) => field in body && body[field] !== undefined);
}
