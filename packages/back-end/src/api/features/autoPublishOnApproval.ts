import { ExperimentRefRule } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  filterEnvironmentsByFeature,
  getFeatureAutopublishOnApproval,
  getMatchingRules,
  getNewDraftExperimentsToPublish,
  isScheduledPublishDue,
  isScheduledPublishPending,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { recordScheduledPublishFailure } from "back-end/src/models/FeatureRevisionModel";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { publishFeatureRevision } from "./postFeatureRevisionPublish";

export function canEnableFeatureAutoPublishOnApproval(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  if (
    !getFeatureAutopublishOnApproval(
      context.org.settings?.requireReviews,
      feature,
    )
  ) {
    return false;
  }

  const allEnvironments = getEnvironments(context.org);
  const environmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);
  return context.permissions.canPublishFeature(feature, environmentIds);
}

// Validate a client-supplied schedule date. null/undefined means "no schedule";
// any value must be a valid future date.
export function parseScheduledPublishDate(
  value: string | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new BadRequestError("Invalid scheduledPublishAt date");
  }
  if (date.getTime() <= Date.now()) {
    throw new BadRequestError("scheduledPublishAt must be in the future");
  }
  return date;
}

// Publish authority over every environment the feature applies to. Anyone with
// it can cancel (or take over) a pending schedule.
export function canPublishFeatureRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  const allEnvironments = getEnvironments(context.org);
  const environmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);
  return context.permissions.canPublishFeature(feature, environmentIds);
}

// Whether the caller may arm a date-based publish. Needs publish authority plus
// the premium feature (canceling needs neither, so a lapsed license can disarm).
export function canScheduleFeaturePublish(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): boolean {
  if (!context.hasPremiumFeature("scheduled-revisions")) return false;
  return canPublishFeatureRevision(context, feature);
}

async function revisionRequiresPreLaunchChecklist(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<boolean> {
  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);
  const experimentIds = [
    ...new Set(
      getMatchingRules(
        feature,
        (rule) => rule.type === "experiment-ref",
        environmentIds,
        revision,
      ).map((result) => (result.rule as ExperimentRefRule).experimentId),
    ),
  ];
  if (experimentIds.length === 0) return false;

  const experiments = await getExperimentsByIds(context, experimentIds);
  const experimentsMap = new Map<string, ExperimentInterfaceStringDates>(
    experiments.map((exp) => [
      exp.id,
      exp as unknown as ExperimentInterfaceStringDates,
    ]),
  );
  return (
    getNewDraftExperimentsToPublish({
      feature,
      revision,
      environments,
      experimentsMap,
    }).length > 0
  );
}

// The dashboard user id an armed publish will run as: the explicit arming user
// (autoPublishEnabledBy at fire time, or the current actor at arm time), else
// the draft's author — but only when that author is a dashboard user. API-key
// and system event users can carry an `id` that is NOT a resolvable user, so
// they return null (the publish can't run with their authority).
export function resolveArmedPublishUserId(
  revision: Pick<
    FeatureRevisionInterface,
    "autoPublishEnabledBy" | "createdBy"
  >,
  armingUserId: string | null,
): string | null {
  const candidate = armingUserId ?? revision.autoPublishEnabledBy ?? null;
  if (candidate) return candidate;
  return revision.createdBy?.type === "dashboard"
    ? revision.createdBy.id
    : null;
}

// Resolve the context an armed publish runs with: whoever armed it
// (autoPublishEnabledBy), falling back to the draft author when that's absent.
async function getArmedPublishContext(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<ReqContext | ApiReqContext | null> {
  const enablerId = resolveArmedPublishUserId(revision, null);
  if (!enablerId) return null;
  try {
    return await getContextForUserIdInOrg(context.org, enablerId);
  } catch {
    return null;
  }
}

// Run the pre-launch checklist gate with the armer's authority, then publish.
// Throws on a failed gate so the caller can decide whether to hold or leave
// approved.
async function publishArmedRevision(
  enablerContext: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  mergeNow: boolean,
): Promise<FeatureRevisionInterface> {
  // Use the armer's context, not the caller's: a reviewer scoped out of a linked
  // experiment's project would see no experiments and skip the checklist.
  if (
    await revisionRequiresPreLaunchChecklist(enablerContext, feature, revision)
  ) {
    throw new Error("pre-launch checklist required");
  }

  // Concurrency note: this shared path can be entered by the poller, by
  // auto-on-approval, and by a manual publish at nearly the same instant.
  // publishFeatureRevision re-fetches and rejects an already-published revision,
  // so in practice the loser throws and is caught upstream. Accepted residual: a
  // sub-second cross-path overlap before either commits could double-fire publish
  // side effects; not guarded with an atomic claim to avoid reworking the shared
  // publish core, and the window requires a coincident trigger at the exact tick.
  const { revision: published } = await publishFeatureRevision(
    {
      context: enablerContext,
      organization: enablerContext.org,
      audit: enablerContext.auditLog.bind(enablerContext),
      params: { id: feature.id, version: revision.version },
      // Only honored for armers who can bypass approvals (force-merge a stale draft).
      body: { comment: "", mergeNow },
    },
    false,
  );
  return published;
}

// Whether an armed publish may force-merge past rebase governance at fire time.
// Requires BOTH the persisted admin-bypass intent on the schedule AND that the
// armer still holds bypass permission. Gating on the armer's role alone would
// force-publish a stale approval for an ordinary (non-bypass) schedule whenever
// the armer happens to be an admin — see governance handling in
// publishFeatureRevision.
function scheduledPublishMayForceMerge(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): boolean {
  return (
    !!revision.scheduledPublishBypassApproval &&
    context.permissions.canBypassApprovalChecks(feature)
  );
}

export async function maybeAutoPublishFeatureRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  // A future-dated schedule defers to the Agenda poller; publish on approval only
  // when there's no date (or it's already due).
  if (isScheduledPublishPending(revision) && !isScheduledPublishDue(revision)) {
    return revision;
  }

  const enablerContext = await getArmedPublishContext(context, revision);
  if (!enablerContext) {
    logger.warn(
      { featureId: feature.id, version: revision.version },
      "auto-publish-on-approval skipped: enabling user could not be resolved; revision left approved",
    );
    return revision;
  }

  try {
    return await publishArmedRevision(
      enablerContext,
      feature,
      revision,
      scheduledPublishMayForceMerge(enablerContext, feature, revision),
    );
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for feature ${feature.id} revision ${revision.version}; left approved for manual publish`,
    );
    return revision;
  }
}

// Date-driven counterpart invoked by the Agenda poller once the target date has
// arrived. If the draft can't publish yet (not approved, stale, conflict) it
// holds and the next tick retries. Admin armers force-merge and skip approval.
// Past this many failed poller attempts (~1/min) a held schedule is treated as
// stuck: we log at error level so it surfaces in monitoring rather than retrying
// silently forever.
const SCHEDULED_PUBLISH_STUCK_AFTER_ATTEMPTS = 10;

export async function maybePublishScheduledRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  if (!isScheduledPublishDue(revision)) return revision;

  const recordFailure = async (message: string) => {
    const attempts = await recordScheduledPublishFailure(revision, message);
    const log =
      attempts >= SCHEDULED_PUBLISH_STUCK_AFTER_ATTEMPTS
        ? logger.error
        : logger.info;
    log(
      { featureId: feature.id, version: revision.version, attempts },
      `scheduled-publish held (will retry next tick): ${message}`,
    );
  };

  const enablerContext = await getArmedPublishContext(context, revision);
  if (!enablerContext) {
    await recordFailure("enabling user could not be resolved");
    return revision;
  }

  try {
    return await publishArmedRevision(
      enablerContext,
      feature,
      revision,
      scheduledPublishMayForceMerge(enablerContext, feature, revision),
    );
  } catch (e) {
    await recordFailure(e instanceof Error ? e.message : String(e));
    return revision;
  }
}
