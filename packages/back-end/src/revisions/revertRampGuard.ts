import type {
  FeatureInterface,
  FeatureRevisionInterface,
  RevisionRampDetachAction,
} from "shared/validators";
import { getRevertRampDetachActions, revertRampStopWarning } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { SoftWarningError } from "back-end/src/util/errors";

type Context = ReqContext | ApiReqContext;

async function getRevertTargetRevision(
  context: Context,
  feature: FeatureInterface,
  revision: Pick<FeatureRevisionInterface, "revertedFrom">,
): Promise<FeatureRevisionInterface | null> {
  if (revision.revertedFrom === undefined) return null;
  return getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: revision.revertedFrom,
  });
}

async function assessRevertRampStops(
  context: Context,
  feature: FeatureInterface,
  targetRevision: FeatureRevisionInterface | null,
): Promise<{ detaches: RevisionRampDetachAction[]; warning: string | null }> {
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

// The ramp targets a revert revision stops, applied after it lands.
export async function getRevertRampDetaches(
  context: Context,
  feature: FeatureInterface,
  revision: Pick<FeatureRevisionInterface, "revertedFrom">,
): Promise<RevisionRampDetachAction[]> {
  const target = await getRevertTargetRevision(context, feature, revision);
  return (await assessRevertRampStops(context, feature, target)).detaches;
}

// Dashboard / direct-revert form: a 422 the "Save anyway?" retry acknowledges.
// Direct reverts pass the target revision itself (the revert revision does not
// exist yet); revert drafts pass the draft.
export async function assertRevertRampStopAcknowledged(
  context: Context,
  feature: FeatureInterface,
  source:
    | { targetRevision: FeatureRevisionInterface }
    | { revision: Pick<FeatureRevisionInterface, "revertedFrom"> },
): Promise<void> {
  if (context.ignoreWarnings) return;
  const target =
    "targetRevision" in source
      ? source.targetRevision
      : await getRevertTargetRevision(context, feature, source.revision);
  const { warning } = await assessRevertRampStops(context, feature, target);
  if (warning) throw new SoftWarningError(warning, [warning]);
}

// REST form: one more acknowledge-class gate in the aggregated 422.
export async function revertRampStopGate(
  context: Context,
  feature: FeatureInterface,
  revision: Pick<FeatureRevisionInterface, "revertedFrom">,
): Promise<PublishGate | null> {
  const target = await getRevertTargetRevision(context, feature, revision);
  const { warning } = await assessRevertRampStops(context, feature, target);
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
