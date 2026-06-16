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

// Parse + validate a client-supplied schedule date. `null`/`undefined` means "no
// schedule"; a value must be a valid, future date. Shared by the internal and
// REST schedule entry points.
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

// Publish authority over every environment this feature applies to. This is the
// permission to cancel a pending schedule — anyone who could publish the feature
// can call off (or take over) a deferred publish.
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

// Whether the caller may arm a deferred (date-based) publish on this feature.
// Unlike auto-publish-on-approval, scheduling isn't gated on the org's
// auto-publish setting — it only needs publish authority (the date is just a
// deferral) — but it's a premium feature in its own right. Cancelling needs no
// premium (see canPublishFeatureRevision) so a lapsed license can still disarm.
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

// Resolve the context an armed publish runs with: the authority of whoever armed
// it (`autoPublishEnabledBy`), falling back to the draft author for revisions
// armed by actors without a user ID (API keys) or before the field existed.
async function getArmedPublishContext(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<ReqContext | ApiReqContext | null> {
  const enablerId =
    revision.autoPublishEnabledBy ??
    (revision.createdBy && "id" in revision.createdBy
      ? revision.createdBy.id
      : null);
  if (!enablerId) return null;
  try {
    return await getContextForUserIdInOrg(context.org, enablerId);
  } catch {
    return null;
  }
}

// Run the pre-launch checklist gate with the armer's authority, then publish.
// Throws on a failed checklist / governance / permission / merge-conflict so the
// caller can decide whether to hold (scheduled) or leave approved (on-approval).
async function publishArmedRevision(
  enablerContext: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  mergeNow: boolean,
): Promise<FeatureRevisionInterface> {
  // Checklist gate runs with the armer's context (the authority we publish with),
  // not the caller's. A reviewer scoped out of a linked experiment's project
  // would otherwise see no experiments and let a draft-experiment feature publish.
  if (
    await revisionRequiresPreLaunchChecklist(enablerContext, feature, revision)
  ) {
    throw new Error("pre-launch checklist required");
  }

  const { revision: published } = await publishFeatureRevision(
    {
      context: enablerContext,
      organization: enablerContext.org,
      audit: enablerContext.auditLog.bind(enablerContext),
      params: { id: feature.id, version: revision.version },
      // mergeNow only takes effect for armers with bypass-approval permission;
      // it lets an admin-armed schedule force-merge a stale draft at fire time.
      body: { comment: "", mergeNow },
    },
    false,
  );
  return published;
}

export async function maybeAutoPublishFeatureRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  // A future-dated schedule defers to the Agenda poller; only publish on the
  // approval event itself when there's no date (or the date has already passed).
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
      enablerContext.permissions.canBypassApprovalChecks(feature),
    );
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for feature ${feature.id} revision ${revision.version}; left approved for manual publish`,
    );
    return revision;
  }
}

// Date-driven counterpart invoked by the scheduled-publish Agenda poller. Fires
// only once the target date has arrived; if the draft can't publish yet (review
// required but not approved, stale approval, merge conflict) it holds — the next
// tick retries — until conditions are met or the schedule is canceled. An admin
// armer with bypass authority force-merges and skips the approval requirement.
export async function maybePublishScheduledRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  if (!isScheduledPublishDue(revision)) return revision;

  const enablerContext = await getArmedPublishContext(context, revision);
  if (!enablerContext) {
    logger.warn(
      { featureId: feature.id, version: revision.version },
      "scheduled-publish skipped: enabling user could not be resolved; schedule left pending",
    );
    return revision;
  }

  try {
    return await publishArmedRevision(
      enablerContext,
      feature,
      revision,
      enablerContext.permissions.canBypassApprovalChecks(feature),
    );
  } catch (e) {
    logger.info(
      { featureId: feature.id, version: revision.version },
      `scheduled-publish held (will retry next tick): ${e instanceof Error ? e.message : String(e)}`,
    );
    return revision;
  }
}
