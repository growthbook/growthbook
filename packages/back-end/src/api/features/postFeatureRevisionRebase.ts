import type { AuditInterfaceInput } from "shared/types/audit";
import type { OrganizationInterface } from "shared/types/organization";
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
import type { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getLiveAndBaseRevisionsForFeature,
  toApiRevision,
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

export async function rebaseFeatureRevision(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number },
  body: { conflictResolutions?: Record<string, unknown> },
  audit: (input: AuditInterfaceInput) => Promise<void>,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: organization.id,
    featureId: feature.id,
    feature,
    version: params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });

  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    (body.conflictResolutions ?? {}) as Record<string, MergeStrategy>,
  );

  if (!mergeResult.success) {
    throw new ConflictError(
      "Unresolved conflicts remain — provide strategies for all conflicting keys",
      mergeResult.conflicts,
    );
  }

  const newRules: FeatureRule[] =
    mergeResult.result.rules ?? feature.rules ?? [];
  const newEnvironmentsEnabled: Record<string, boolean> = {};
  environmentIds.forEach((env) => {
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
  // v2: rules merge at the whole-array level, so when the rebase produced a
  // new rules array we treat every env the feature is in as potentially
  // changed for review-reset purposes. (The old per-env keys only reflected
  // which envs had explicit overrides, not which rules actually changed.)
  const rulesChanged = mergeResult.result.rules !== undefined;
  const changedEnvsFromRebase = Array.from(
    new Set([
      ...(rulesChanged ? environmentIds : []),
      ...Object.keys(mergeResult.result.environmentsEnabled ?? {}),
    ]),
  );
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: changedEnvsFromRebase,
    defaultValueChanged: mergeResult.result.defaultValue !== undefined,
    settings: organization.settings,
  });

  await updateRevision(
    context,
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
      user: context.auditUser,
      action: "rebase",
      subject: `on top of revision #${live.version}`,
      value: JSON.stringify(mergeResult.result),
    },
    resetReview,
  );

  const updated = await getRevision({
    context,
    organization: organization.id,
    featureId: feature.id,
    feature,
    version: params.version,
  });
  const finalRevision = updated ?? revision;

  await audit({
    event: "feature.revision.rebase",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { baseVersion: revision.baseVersion },
      { baseVersion: live.version },
      { version: revision.version },
    ),
  });

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    finalRevision,
    "revision.rebased",
    { baseVersion: live.version },
  );

  return { feature, revision: finalRevision };
}

export const postFeatureRevisionRebase = createApiRequestHandler(
  postFeatureRevisionRebaseValidator,
)(async (req) => {
  const { feature, revision } = await rebaseFeatureRevision(
    req.context,
    req.organization,
    req.params,
    req.body,
    req.audit,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
