import type {
  FeatureInterface,
  FeatureRevisionInterface,
  RevisionRampDetachAction,
} from "shared/validators";
import {
  draftRevertedFromVersion,
  getRevertRampDetachActions,
  revertRampStopWarning,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { SoftWarningError } from "back-end/src/util/errors";

type Context = ReqContext | ApiReqContext;
type RevertSource = Pick<
  FeatureRevisionInterface,
  "revertedFrom" | "revertedFromVersion"
>;

async function getRevertTargetRevision(
  context: Context,
  feature: FeatureInterface,
  revision: RevertSource,
): Promise<FeatureRevisionInterface | null> {
  const version = draftRevertedFromVersion(revision);
  if (version === undefined) return null;
  return getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version,
  });
}

export type RevertRampStops = {
  detaches: RevisionRampDetachAction[];
  warning: string | null;
};

export async function resolveRevertRampStops(
  context: Context,
  feature: FeatureInterface,
  targetRevision: FeatureRevisionInterface | null,
): Promise<RevertRampStops> {
  if (!targetRevision) return { detaches: [], warning: null };
  const schedules = await context.models.rampSchedules.getAllByFeatureId(
    feature.id,
  );
  const detaches = getRevertRampDetachActions(
    feature.id,
    targetRevision,
    schedules,
  );
  return { detaches, warning: revertRampStopWarning(detaches, schedules) };
}

// Resolved before the publish mutates anything, so a failed read blocks the
// revert and the detaches applied afterwards are the ones warned about.
export async function resolveRevertRampStopsForRevision(
  context: Context,
  feature: FeatureInterface,
  revision: RevertSource,
): Promise<RevertRampStops> {
  return resolveRevertRampStops(
    context,
    feature,
    await getRevertTargetRevision(context, feature, revision),
  );
}

// Dashboard / direct-revert form: a 422 the "Save anyway?" retry acknowledges.
export function assertRevertRampStopsAcknowledged(
  context: Context,
  { warning }: RevertRampStops,
): void {
  if (warning && !context.ignoreWarnings) {
    throw new SoftWarningError(warning, [warning]);
  }
}

// REST form: one more acknowledge-class gate in the aggregated 422.
export async function revertRampStopGate(
  context: Context,
  feature: FeatureInterface,
  revision: RevertSource,
): Promise<PublishGate | null> {
  const { warning } = await resolveRevertRampStopsForRevision(
    context,
    feature,
    revision,
  );
  if (!warning) return null;
  return {
    type: "revert-stops-ramp",
    severity: "warning",
    messages: [warning],
    override: "ignoreWarnings",
    requiresPermission: null,
    resolution: null,
  };
}
