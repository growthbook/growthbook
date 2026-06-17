import { ExperimentRefRule } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  filterEnvironmentsByFeature,
  getFeatureAutopublishOnApproval,
  getMatchingRules,
  getNewDraftExperimentsToPublish,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
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

export async function maybeAutoPublishFeatureRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Promise<FeatureRevisionInterface> {
  if (!revision.autoPublishOnApproval) return revision;
  if (revision.status !== "approved") return revision;

  // Publish with the authority of whoever armed auto-publish. Fall back to
  // the draft author for revisions armed by actors without a user ID (API
  // keys) or before `autoPublishEnabledBy` existed.
  const enablerId =
    revision.autoPublishEnabledBy ??
    (revision.createdBy && "id" in revision.createdBy
      ? revision.createdBy.id
      : null);
  if (!enablerId) {
    logger.warn(
      { featureId: feature.id, version: revision.version },
      "auto-publish-on-approval skipped: enabling user has no id; revision left approved",
    );
    return revision;
  }

  try {
    const enablerContext = await getContextForUserIdInOrg(
      context.org,
      enablerId,
    );
    if (!enablerContext) {
      logger.warn(
        { featureId: feature.id, version: revision.version, enablerId },
        "auto-publish-on-approval skipped: enabling user could not be resolved; revision left approved",
      );
      return revision;
    }

    // Run the checklist gate with the armer's context (the authority we publish
    // with), not the caller's. A reviewer scoped out of a linked experiment's
    // project would otherwise see no experiments and let a draft-experiment
    // feature auto-publish.
    if (
      await revisionRequiresPreLaunchChecklist(
        enablerContext,
        feature,
        revision,
      )
    ) {
      logger.info(
        { featureId: feature.id, version: revision.version },
        "auto-publish-on-approval skipped: pre-launch checklist required",
      );
      return revision;
    }

    const { revision: published } = await publishFeatureRevision(
      {
        context: enablerContext,
        organization: enablerContext.org,
        audit: enablerContext.auditLog.bind(enablerContext),
        params: { id: feature.id, version: revision.version },
        body: { comment: "" },
      },
      false,
    );
    return published;
  } catch (e) {
    logger.error(
      e,
      `auto-publish-on-approval failed for feature ${feature.id} revision ${revision.version}; left approved for manual publish`,
    );
    return revision;
  }
}
