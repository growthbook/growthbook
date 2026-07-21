import type { AuditInterfaceInput } from "shared/types/audit";
import type { OrganizationInterface } from "shared/types/organization";
import {
  autoMerge,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
  MergeStrategy,
  pruneOrphanedRampActions,
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
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { maybeAutoPublishFeatureRevision } from "./autoPublishOnApproval";
import { isDraftStatus } from "./validations";

export type RebaseRequestBody = {
  conflictResolutions?: Record<string, unknown>;
  expectedLiveVersion?: number;
  expectedDraftDateUpdated?: string;
};

// Shared compute phase for the rebase and rebase-preview endpoints: loads,
// validates permissions/status/concurrency guards, and runs the three-way
// merge with the supplied resolutions. Performs no writes.
export async function computeRebaseMerge(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number },
  body: RebaseRequestBody,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // The preview requires the same permission as the rebase itself: it is a
  // planning step for that write, and accepting arbitrary resolutions makes
  // it more than a passive read.
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

  // Optimistic concurrency for the draft side: resolutions were authored
  // against specific draft content. Any draft mutation bumps `dateUpdated`,
  // so a timestamp mismatch means the resolutions may no longer apply to what
  // the caller reviewed.
  if (body.expectedDraftDateUpdated !== undefined) {
    const expected = new Date(body.expectedDraftDateUpdated).getTime();
    if (Number.isNaN(expected)) {
      throw new BadRequestError(
        "expectedDraftDateUpdated must be a valid date-time string",
      );
    }
    if (expected !== revision.dateUpdated.getTime()) {
      throw new ConflictError(
        `The draft was modified at ${revision.dateUpdated.toISOString()} (expected ${new Date(
          expected,
        ).toISOString()}). Re-check the merge status and resubmit resolutions against the current draft.`,
      );
    }
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });

  // Optimistic concurrency: resolutions were authored against a specific live
  // version. If live moved since, the conflict keys may now refer to different
  // content — refuse rather than apply resolutions to the wrong conflicts.
  if (
    body.expectedLiveVersion !== undefined &&
    body.expectedLiveVersion !== live.version
  ) {
    throw new ConflictError(
      `The live version is now #${live.version} (expected #${body.expectedLiveVersion}). Re-check the merge status and resubmit resolutions against the current conflicts.`,
    );
  }

  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    (body.conflictResolutions ?? {}) as Record<string, MergeStrategy>,
  );

  return { feature, revision, live, environmentIds, mergeResult };
}

export async function rebaseFeatureRevision(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number },
  body: RebaseRequestBody,
  audit: (input: AuditInterfaceInput) => Promise<void>,
) {
  const { feature, revision, live, environmentIds, mergeResult } =
    await computeRebaseMerge(context, organization, params, body);

  if (!mergeResult.success) {
    throw new MergeConflictError(
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

  // The merge can drop a rule that a pending ramp action targets (e.g. live
  // deleted it). Prune those orphaned actions rather than carrying dead
  // intent forward; the prune is recorded in the rebase log entry below.
  const { kept: keptRampActions, pruned: prunedRampActions } =
    pruneOrphanedRampActions(revision.rampActions, newRules);

  // A rebase that actually pulls in upstream changes must re-trigger review
  // per org policy — the prior approval was for pre-rebase content.
  // The merged result carries rules as a whole array, so when the rebase
  // produced a new one we treat every env the feature is in as potentially
  // changed for review-reset purposes. (Per-env keys only reflected which
  // envs had explicit overrides, not which rules actually changed.)
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
      ...(prunedRampActions.length > 0 ? { rampActions: keptRampActions } : {}),
    },
    {
      user: context.auditUser,
      action: "rebase",
      subject: `on top of revision #${live.version}`,
      value: JSON.stringify(
        prunedRampActions.length > 0
          ? { ...mergeResult.result, prunedRampActions }
          : mergeResult.result,
      ),
    },
    resetReview,
    // Rebase is permitted while a "lock edits" schedule is active.
    { bypassScheduleLock: true },
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

  // A clean rebase (no review reset) keeps an approved+armed draft approved;
  // re-fire auto-publish so it merges now it's rebased onto live.
  const publishedRevision = await maybeAutoPublishFeatureRevision(
    context,
    feature,
    finalRevision,
  );

  return { feature, revision: publishedRevision };
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
