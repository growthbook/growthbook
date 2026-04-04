import omit from "lodash/omit";
import { z } from "zod";
import {
  autoMerge,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
  MergeConflict,
  MergeStrategy,
} from "shared/util";
import type { FeatureRule } from "shared/types/feature";
import { RevisionMetadata } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/util/organization.util";

export const postFeatureRevisionRebase = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    strategies: z
      .record(z.string(), z.enum(["overwrite", "discard"]))
      .optional()
      .default({}),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

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
  if (!revision) throw new Error("Could not find feature revision");

  const rebasableStatuses = [
    "draft",
    "pending-review",
    "changes-requested",
    "approved",
  ];
  if (!rebasableStatuses.includes(revision.status)) {
    throw new Error(
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
    req.body.strategies as Record<string, MergeStrategy>,
  );

  if (!mergeResult.success) {
    const err: Error & { status?: number; conflicts?: MergeConflict[] } =
      new Error(
        "Unresolved conflicts remain — provide strategies for all conflicting keys",
      );
    err.status = 409;
    err.conflicts = mergeResult.conflicts;
    throw err;
  }

  // Build fully-resolved rule/env maps (mirrors dashboard rebase logic)
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
    false,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
