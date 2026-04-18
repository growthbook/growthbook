import {
  autoMerge,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
  MergeStrategy,
  resetReviewOnChange,
} from "shared/util";
import type { FeatureRule } from "shared/types/feature";
import {
  RevisionMetadata,
  postFeatureRevisionRebaseValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getLiveAndBaseRevisionsForFeature,
  revisionToApiInterface,
} from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { isDraftStatus } from "./validations";

export const postFeatureRevisionRebase = createApiRequestHandler(
  postFeatureRevisionRebaseValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });

  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    (req.body.conflictResolutions ?? {}) as Record<string, MergeStrategy>,
  );

  if (!mergeResult.success) {
    throw new ConflictError(
      "Unresolved conflicts remain — provide strategies for all conflicting keys",
      mergeResult.conflicts,
    );
  }

  const newRules: Record<string, FeatureRule[]> = {};
  const newEnvironmentsEnabled: Record<string, boolean> = {};
  environmentIds.forEach((env) => {
    newRules[env] =
      mergeResult.result.rules?.[env] ??
      feature.environmentSettings?.[env]?.rules ??
      [];
    newEnvironmentsEnabled[env] =
      mergeResult.result.environmentsEnabled?.[env] ??
      feature.environmentSettings?.[env]?.enabled ??
      false;
  });

  const featureMetadataSnapshot: RevisionMetadata = {
    description: feature.description,
    owner: feature.owner,
    project: feature.project,
    tags: feature.tags,
    neverStale: feature.neverStale,
    customFields: feature.customFields,
    jsonSchema: feature.jsonSchema,
    valueType: feature.valueType,
  };
  const newMetadata: RevisionMetadata = mergeResult.result.metadata
    ? { ...featureMetadataSnapshot, ...mergeResult.result.metadata }
    : featureMetadataSnapshot;

  // A rebase that actually pulls in upstream changes must re-trigger review
  // per org policy — the prior approval was for pre-rebase content.
  const changedEnvsFromRebase = Array.from(
    new Set([
      ...Object.keys(mergeResult.result.rules ?? {}),
      ...Object.keys(mergeResult.result.environmentsEnabled ?? {}),
    ]),
  );
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: changedEnvsFromRebase,
    defaultValueChanged: mergeResult.result.defaultValue !== undefined,
    settings: req.organization.settings,
  });

  await updateRevision(
    req.context,
    feature,
    revision,
    {
      baseVersion: live.version,
      defaultValue: mergeResult.result.defaultValue ?? feature.defaultValue,
      rules: newRules,
      environmentsEnabled: newEnvironmentsEnabled,
      prerequisites:
        mergeResult.result.prerequisites ?? feature.prerequisites ?? [],
      archived: mergeResult.result.archived ?? feature.archived ?? false,
      metadata: newMetadata,
      holdout:
        "holdout" in mergeResult.result
          ? mergeResult.result.holdout
          : (feature.holdout ?? null),
    },
    {
      user: req.context.auditUser,
      action: "rebase",
      subject: `on top of revision #${live.version}`,
      value: JSON.stringify(mergeResult.result),
    },
    resetReview,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await req.audit({
    event: "feature.revision.rebase",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { baseVersion: revision.baseVersion },
      { baseVersion: live.version },
      { version: revision.version },
    ),
  });

  await dispatchFeatureRevisionEvent(
    req.context,
    feature,
    finalRevision,
    "revision.rebased",
    { baseVersion: live.version },
  );

  return { revision: revisionToApiInterface(finalRevision) };
});
