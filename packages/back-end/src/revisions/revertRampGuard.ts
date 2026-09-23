import type {
  FeatureInterface,
  FeatureRevisionInterface,
  RampScheduleInterface,
  RevisionRampDetachAction,
} from "shared/validators";
import { getRevertRampDetachActions, revertRampStopWarning } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { SoftWarningError } from "back-end/src/util/errors";

type Context = ReqContext | ApiReqContext;
// `revertedFrom`, not the provenance-only `revertedFromVersion`: it is cleared
// once the draft's content is edited and is not copied into forks, so only a
// draft that still restores its target detaches ramps.
type RevertSource = Pick<FeatureRevisionInterface, "revertedFrom">;

async function getRevertTargetRevision(
  context: Context,
  feature: FeatureInterface,
  revision: RevertSource,
): Promise<FeatureRevisionInterface | null> {
  const version = revision.revertedFrom;
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
  // The schedules the detaches remove targets from.
  schedules: Pick<RampScheduleInterface, "id" | "name" | "dateCreated">[];
};

export async function resolveRevertRampStops(
  context: Context,
  feature: FeatureInterface,
  targetRevision: FeatureRevisionInterface | null,
): Promise<RevertRampStops> {
  if (!targetRevision) return { detaches: [], warning: null, schedules: [] };
  const schedules = await context.models.rampSchedules.getAllByFeatureId(
    feature.id,
  );
  const detaches = getRevertRampDetachActions(
    feature.id,
    targetRevision,
    schedules,
  );
  return {
    detaches,
    schedules: schedules.filter((s) =>
      detaches.some((d) => d.rampScheduleId === s.id),
    ),
    warning: revertRampStopWarning(detaches, schedules, {
      apiRequest: context.isApiRequest,
    }),
  };
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

// A scheduled or auto-published revert runs with no request, so nobody sees
// the warning. It may still remove the ramps attached when the draft was made
// (its base revision's recorded attachments), but not one attached since: that
// publish fails instead, to be confirmed by publishing manually.
export async function assertUnattendedRevertRampStopsPredateDraft(
  context: Context,
  feature: FeatureInterface,
  draft: Pick<FeatureRevisionInterface, "baseVersion" | "dateCreated">,
  { detaches, schedules }: RevertRampStops,
): Promise<void> {
  if (context.req || !detaches.length) return;
  const base = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: draft.baseVersion,
  });
  const known = base?.rampAttachments;
  const newerIds = new Set(
    detaches
      .filter((d) => {
        if (known) {
          return !known.some(
            (a) =>
              a.rampScheduleId === d.rampScheduleId && a.ruleId === d.ruleId,
          );
        }
        // Unrecorded base: the schedule's creation is the best evidence.
        const s = schedules.find((x) => x.id === d.rampScheduleId);
        return (
          !!s &&
          new Date(s.dateCreated).getTime() >
            new Date(draft.dateCreated).getTime()
        );
      })
      .map((d) => d.rampScheduleId),
  );
  const newer = schedules.filter((s) => newerIds.has(s.id));
  if (!newer.length) return;
  const names = newer.map((s) => `"${s.name}" (${s.id})`).join(", ");
  throw new Error(
    `This revert would delete the ramp ${newer.length === 1 ? "schedule" : "schedules"} ${names}, attached after the revert draft was created. Publish the draft manually to confirm.`,
  );
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
