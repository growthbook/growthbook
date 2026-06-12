import {
  autoMerge,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getLiveChangesSinceBase,
  liveRevisionFromFeature,
} from "shared/util";
import { getFeatureRevisionMergeStatusValidator } from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/util/organization.util";

// Shared handler: v1 and v2 have identical request/response schemas and the
// merge result contains internal rule shapes (not API-serialized).
export const mergeStatusHandler = async (req: {
  context: Parameters<typeof getFeature>[0];
  organization: { id: string };
  params: { id: string; version: number };
}) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });

  const filledLive = liveRevisionFromFeature(live, feature);
  const filledBase = fillRevisionFromFeature(base, feature);
  const mergeResult = autoMerge(
    filledLive,
    filledBase,
    revision,
    environmentIds,
    {},
  );

  // Pre-flight signal for the publish endpoint's rebase governance: true when
  // publishing would be blocked until the draft is rebased (merge conflicts,
  // or the draft is behind live / its approval went stale while the org
  // enforces rebase-before-publish).
  const governance = evaluatePublishGovernance({
    revisionStatus: revision.status,
    baseVersion: revision.baseVersion,
    liveVersion: live.version,
    mergeSuccess: mergeResult.success,
    liveChanges: getLiveChangesSinceBase(
      filledLive,
      filledBase,
      environmentIds,
    ),
    approvedBaseVersion: revision.approvedBaseVersion ?? null,
    requireRebaseBeforePublish:
      !!req.context.org.settings?.requireRebaseBeforePublish,
  });

  return {
    success: mergeResult.success,
    liveVersion: live.version,
    draftDateUpdated: revision.dateUpdated.toISOString(),
    conflicts: mergeResult.conflicts,
    rebaseRequired: governance.rebaseRequired,
    ...(mergeResult.success ? { result: mergeResult.result } : {}),
  };
};

export const getFeatureRevisionMergeStatus = createApiRequestHandler(
  getFeatureRevisionMergeStatusValidator,
)(mergeStatusHandler);
