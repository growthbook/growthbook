import isEqual from "lodash/isEqual";
import {
  autoMerge,
  AutoMergeResult,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  getMatchingRules,
  liveRevisionFromFeature,
  MatchingRule,
  mergeResultHasChanges,
  resetReviewOnChange,
  checkIfRevisionNeedsReview,
} from "shared/util";
import { isVariationWeightsSumValid } from "shared/experiments";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import { Variation } from "shared/types/experiment";
import { OrganizationSettings } from "shared/types/organization";
import {
  ContextualBanditInterface,
  ExperimentInterface,
  ExperimentRefRule,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureRule,
} from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import {
  editFeatureRules,
  getFeature,
  prevalidatePublishRevision,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { removePendingFeatureDraftFromExperiment } from "back-end/src/models/ExperimentModel";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  assertCanAutoPublish,
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
  getLiveRevisionForFeature,
} from "back-end/src/services/features";
import { assertConfigBackedFeatureValuesValid } from "back-end/src/services/configValidation";

export type ExperimentFeatureUpdatePlan = {
  feature: FeatureInterface;
  existingRevision?: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
};

export type ExperimentFeatureValueRevisionOptions = {
  targetVersion?: number;
  autoPublish?: boolean;
  forceNewDraft?: boolean;
};

export type ExperimentLinkedFeatureValueUpdate = {
  variations: ExperimentRefVariation[];
  // JSON features only. When provided, sets the matching experiment-ref rule's
  // sparse flag (the variation values are partial objects merged onto the
  // feature default). Omitted = leave the rule's existing sparse flag untouched.
  sparse?: boolean;
  revisionOptions: ExperimentFeatureValueRevisionOptions;
};

function assertLinkedFeatureRevisionOptions(
  featureId: string,
  revisionOptions: ExperimentFeatureValueRevisionOptions | undefined,
): asserts revisionOptions is ExperimentFeatureValueRevisionOptions {
  if (revisionOptions === undefined) {
    throw new Error(`Feature ${featureId}: revisionOptions is required`);
  }
  if (
    revisionOptions.targetVersion === undefined &&
    revisionOptions.autoPublish === undefined &&
    revisionOptions.forceNewDraft === undefined
  ) {
    throw new Error(
      `Feature ${featureId}: revisionOptions must set at least one of targetVersion, autoPublish, or forceNewDraft`,
    );
  }
}

export function validateExperimentFeatureVariations({
  variations,
  variationWeights,
  experiment,
  features,
}: {
  variations: Variation[];
  variationWeights: number[];
  experiment: ExperimentInterface;
  features: Record<string, ExperimentLinkedFeatureValueUpdate>;
}) {
  const existingVariations = experiment.variations;

  if (variations.length !== variationWeights.length) {
    throw new Error("variations and variationWeights must be the same length.");
  }
  if (!isVariationWeightsSumValid(variationWeights)) {
    throw new Error("variationWeights must add up to 1.");
  }
  if (variations.length < existingVariations.length) {
    throw new Error("Existing experiment variations cannot be removed.");
  }
  for (let i = 0; i < existingVariations.length; i++) {
    const existingVariation = existingVariations[i];
    const incomingVariation = variations[i];
    if (
      existingVariation?.id &&
      (!incomingVariation || incomingVariation.id !== existingVariation.id)
    ) {
      throw new Error(
        "Existing experiment variation IDs must remain unchanged. Only new variations can be added.",
      );
    }
  }
  if (
    Object.values(features).some(
      (v) => v.variations.length !== variations.length,
    )
  ) {
    throw new Error("All features must specify values for all variations.");
  }
  for (const [featureId, entry] of Object.entries(features)) {
    const refVariations = entry.variations;
    for (let i = 0; i < refVariations.length; i++) {
      const expectedVariationId = variations[i]?.id;
      if (!expectedVariationId) {
        throw new Error(
          `Variation at index ${i} is missing an id; ensure variations are normalized before validation.`,
        );
      }
      if (refVariations[i].variationId !== expectedVariationId) {
        throw new Error(
          `Feature ${featureId}: experiment ref variation at index ${i} must use variationId "${expectedVariationId}".`,
        );
      }
    }
  }
}

export async function updateExperimentRefVariations({
  context,
  feature,
  revision,
  matchingRules,
  updatedVariationValues,
  sparse,
  user,
  orgSettings,
}: {
  context: ReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
  updatedVariationValues: ExperimentRefVariation[];
  sparse?: boolean;
  user: EventUser;
  orgSettings?: OrganizationSettings;
}): Promise<FeatureRevisionInterface> {
  // Experiment-served values must satisfy the backing Config's schema +
  // invariants, the same as a direct feature publish — enforced here at
  // variation-save time. Covers standard experiments and multi-armed bandits
  // (a MAB is an experiment whose linked-feature rule is an ordinary
  // experiment-ref). Respects skipSchemaValidation / blockPublishOnSchemaError /
  // ignoreWarnings via the shared validator; a no-op unless the feature is
  // config-backed JSON.
  const seenRuleIds = new Set<string>();
  const rulesToValidate: FeatureRule[] = [];
  for (const { rule } of matchingRules) {
    if (seenRuleIds.has(rule.id)) continue;
    seenRuleIds.add(rule.id);
    rulesToValidate.push({
      ...rule,
      variations: updatedVariationValues,
    } as ExperimentRefRule);
  }
  await assertConfigBackedFeatureValuesValid(context, feature, {
    rules: rulesToValidate,
  });

  const changedEnvironments = matchingRules.map((m) => m.environmentId);
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments,
    defaultValueChanged: false,
    settings: orgSettings,
  });

  // `matchingRules` can duplicate a rule across envs; `editFeatureRules`
  // dedupes by ruleId so the overlay runs once per rule.
  const updatedRevision = await editFeatureRules(
    context,
    feature,
    revision,
    matchingRules.map((m) => ({
      ruleId: m.rule.id,
      environmentId: m.environmentId,
    })),
    {
      variations: updatedVariationValues,
      ...(sparse !== undefined && { sparse }),
    },
    user,
    resetReview,
  );

  if (!updatedRevision) {
    throw new Error(
      `Failed to update experiment ref variations for feature ${feature.id} on the draft revision`,
    );
  }

  return updatedRevision;
}

export async function validateExperimentFeatureUpdates({
  experiment,
  features,
  linkedFeatures,
  context,
}: {
  experiment: ExperimentInterface;
  features: Record<string, ExperimentLinkedFeatureValueUpdate>;
  linkedFeatures: FeatureInterface[];
  context: ReqContext;
}): Promise<ExperimentFeatureUpdatePlan[]> {
  const plans: ExperimentFeatureUpdatePlan[] = [];

  for (const feature of linkedFeatures) {
    const entry = features[feature.id];
    if (!entry) {
      throw new Error(
        `No feature value update provided for feature ${feature.id}`,
      );
    }
    assertLinkedFeatureRevisionOptions(feature.id, entry.revisionOptions);
    const { targetVersion, autoPublish, forceNewDraft } = entry.revisionOptions;

    const useExistingRevision = targetVersion && !forceNewDraft && !autoPublish;

    const revision = useExistingRevision
      ? await getDraftRevision(context, feature, targetVersion)
      : await getLiveRevisionForFeature(context, feature);

    const matchingRules = getMatchingRules(
      feature,
      (r: FeatureRule) =>
        r.type === "experiment-ref" && r.experimentId === experiment.id,
      context.environments,
      revision,
    );

    if (!matchingRules.length)
      throw new Error(
        `No experiment-ref rules found for this experiment on feature ${feature.id}, version ${revision.version}`,
      );

    const baselineVariations = (matchingRules[0].rule as ExperimentRefRule)
      .variations;

    for (let i = 1; i < matchingRules.length; i++) {
      const rule = matchingRules[i].rule as ExperimentRefRule;
      if (!isEqual(rule.variations, baselineVariations)) {
        throw new Error(
          `Feature ${feature.id}: variation values must be identical across all environments to edit feature values on an experiment.`,
        );
      }
    }

    const updatedVariationValues = entry.variations;
    const featureNeedsUpdate = matchingRules.some((m: MatchingRule) => {
      if (m.rule.type !== "experiment-ref") return false;
      return !isEqual(m.rule.variations, updatedVariationValues);
    });

    if (!featureNeedsUpdate) continue;

    if (autoPublish) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          matchingRules.map((m) => m.environmentId),
        )
      ) {
        context.permissions.throwPermissionError();
      }

      const ruleIds = Array.from(
        new Set(
          matchingRules
            .map((m) => m.rule.id)
            .filter((id): id is string => !!id),
        ),
      );
      const projectedRevision = applyPartialFeatureRuleUpdatesToRevision(
        revision,
        ruleIds,
        { variations: updatedVariationValues },
      );
      await assertCanAutoPublish(context, feature, projectedRevision);
    }

    plans.push({
      feature,
      existingRevision: useExistingRevision ? revision : undefined,
      matchingRules,
    });
  }

  return plans;
}

export type PendingDraftFailureReason =
  | "merge-conflict"
  | "needs-rebase"
  | "needs-approval"
  | "publish-error";

export type PendingDraftFailure = {
  featureId: string;
  revisionVersion: number;
  reason: PendingDraftFailureReason;
};

export type PendingDraftPublishResult = {
  published: { featureId: string; revisionVersion: number }[];
  failed: PendingDraftFailure[];
};

// Shared between UI and REST API start paths so error copy stays consistent.
export function formatPendingDraftFailureMessage(
  failed: PendingDraftFailure[],
): string {
  // Dedupe — multiple drafts of one feature can each fail, but the user
  // only needs to see the feature once.
  const ids = (reason: PendingDraftFailureReason) =>
    Array.from(
      new Set(
        failed.filter((f) => f.reason === reason).map((f) => f.featureId),
      ),
    );
  const conflictIds = ids("merge-conflict");
  const rebaseIds = ids("needs-rebase");
  const approvalIds = ids("needs-approval");
  const errorIds = ids("publish-error");

  const plural = failed.length > 1 ? "s" : "";
  const parts: string[] = [];
  if (conflictIds.length) {
    parts.push(
      `merge conflict${conflictIds.length > 1 ? "s" : ""} in: ${conflictIds.join(", ")}`,
    );
  }
  if (rebaseIds.length) {
    parts.push(
      `draft${rebaseIds.length > 1 ? "s" : ""} behind live (rebase needed, no conflicts) on: ${rebaseIds.join(", ")}`,
    );
  }
  if (approvalIds.length) {
    parts.push(`pending approval on: ${approvalIds.join(", ")}`);
  }
  if (errorIds.length) {
    parts.push(
      `unexpected publish error${errorIds.length > 1 ? "s" : ""} on: ${errorIds.join(", ")}`,
    );
  }
  return `Cannot start experiment: feature flag draft${plural} could not be published (${parts.join("; ")}). Resolve the issue${plural} and try again.`;
}

type ResolvedDraft = { featureId: string; revisionVersion: number };

// Merges a draft against live exactly like the manual publish flow does:
// the same fillRevisionFromFeature/liveRevisionFromFeature normalization the
// FF detail page applies (raw sparse revisions produce phantom conflicts),
// followed by the same publish governance. `rebaseRequired` is only set for
// the mergeable-but-blocked case (org requires rebase-before-publish or the
// approval went stale) — true conflicts are reported via `mergeResult`.
function mergeDraftForAutoPublish(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  live: FeatureRevisionInterface,
  base: FeatureRevisionInterface,
): { mergeResult: AutoMergeResult; rebaseRequired: boolean } {
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    context.environments,
    {},
  );
  const governance = evaluatePublishGovernance({
    revisionStatus: revision.status,
    baseVersion: revision.baseVersion,
    liveVersion: live.version,
    mergeSuccess: mergeResult.success,
    liveChanges: [],
    approvedBaseVersion: revision.approvedBaseVersion ?? null,
    requireRebaseBeforePublish:
      !!context.org.settings?.requireRebaseBeforePublish,
  });
  return {
    mergeResult,
    rebaseRequired: mergeResult.success && governance.rebaseRequired,
  };
}

type ReadyDraft = ResolvedDraft & {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  mergeResult: AutoMergeResult;
};

// Auto-publishes pendingFeatureDrafts on experiment start. Phase 1 resolves
// each draft once (prune stale, gate on approval, merge against live with
// the same normalization + governance as the manual publish flow);
// Phase 1.5 prevalidates custom hooks; Phase 2 publishes sequentially,
// reusing the resolved state except when an earlier publish in this run
// advanced the same feature's live version, which forces a re-merge.
// Halts on the first merge conflict or publish error so the caller can
// abort the experiment transition.
export async function publishPendingFeatureDraftsForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  bypassLockdown = false,
): Promise<PendingDraftPublishResult> {
  const drafts = experiment.pendingFeatureDrafts ?? [];
  if (!drafts.length) return { published: [], failed: [] };

  const failed: PendingDraftFailure[] = [];
  const ready: ReadyDraft[] = [];
  // Multiple drafts can target the same feature — fetch each feature once.
  const featureCache = new Map<string, FeatureInterface | null>();
  const getCachedFeature = async (featureId: string) => {
    if (!featureCache.has(featureId)) {
      featureCache.set(featureId, await getFeature(context, featureId));
    }
    return featureCache.get(featureId) ?? null;
  };

  // ── Phase 1: prune stale + gate on approval + merge against live ─────────
  for (const { featureId, revisionVersion } of drafts) {
    const feature = await getCachedFeature(featureId);
    if (!feature) {
      await removePendingFeatureDraftFromExperiment(
        context,
        experiment.id,
        featureId,
        revisionVersion,
      );
      continue;
    }

    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: revisionVersion,
    });
    if (
      !revision ||
      revision.status === "published" ||
      revision.status === "discarded"
    ) {
      await removePendingFeatureDraftFromExperiment(
        context,
        experiment.id,
        featureId,
        revisionVersion,
      );
      continue;
    }

    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision,
    });
    const requiresReview = checkIfRevisionNeedsReview({
      feature,
      baseRevision: base,
      revision,
      allEnvironments: context.environments,
      settings: context.org.settings,
      requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    });
    if (requiresReview && revision.status !== "approved") {
      logger.warn(
        { experimentId: experiment.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: approval required but not yet approved",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-approval" });
      continue;
    }

    const { mergeResult, rebaseRequired } = mergeDraftForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
    );
    if (rebaseRequired) {
      logger.warn(
        { experimentId: experiment.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: rebase with live required before publishing",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-rebase" });
      continue;
    }
    ready.push({ featureId, revisionVersion, feature, revision, mergeResult });
  }

  if (failed.length > 0) {
    return { published: [], failed };
  }

  // ── Phase 1.5: prevalidate custom hooks for every ready draft ────────────
  // A hook rejection fails the whole batch before anything publishes.
  for (const { feature, revision, mergeResult } of ready) {
    // Merge conflicts and no-op drafts are handled by phase 2.
    if (!mergeResult.success || !mergeResultHasChanges(mergeResult)) continue;
    await prevalidatePublishRevision({
      context,
      feature,
      revision,
      result: mergeResult.result,
      comment: `Experiment "${experiment.name}" started`,
    });
  }

  // ── Phase 2: sequential publish ───────────────────────────────────────────
  // Ascending version per feature so each merge builds on the previous publish.
  ready.sort(
    (a, b) =>
      a.featureId.localeCompare(b.featureId) ||
      a.revisionVersion - b.revisionVersion,
  );

  const published: ResolvedDraft[] = [];
  // Features whose live version we advanced during this loop — later drafts
  // of these features must re-merge against the fresh live state.
  const publishedFeatureIds = new Set<string>();

  for (const entry of ready) {
    const { featureId, revisionVersion } = entry;
    let { feature, revision, mergeResult } = entry;

    if (publishedFeatureIds.has(featureId)) {
      const freshFeature = await getFeature(context, featureId);
      if (!freshFeature) continue;
      feature = freshFeature;
      const freshRevision = await getRevision({
        context,
        organization: feature.organization,
        featureId: feature.id,
        feature,
        version: revisionVersion,
      });
      if (
        !freshRevision ||
        freshRevision.status === "published" ||
        freshRevision.status === "discarded"
      ) {
        continue;
      }
      revision = freshRevision;
      const { live, base } = await getLiveAndBaseRevisionsForFeature({
        context,
        feature,
        revision,
      });
      const remerged = mergeDraftForAutoPublish(
        context,
        feature,
        revision,
        live,
        base,
      );
      mergeResult = remerged.mergeResult;
      if (remerged.rebaseRequired) {
        logger.warn(
          { experimentId: experiment.id, featureId, revisionVersion },
          "Cannot auto-publish pending feature draft: rebase with live required after an earlier publish advanced the feature",
        );
        failed.push({ featureId, revisionVersion, reason: "needs-rebase" });
        break;
      }
    }

    if (!mergeResult.success) {
      logger.warn(
        {
          experimentId: experiment.id,
          featureId,
          revisionVersion,
          conflicts: mergeResult.conflicts,
        },
        "Cannot auto-publish pending feature draft due to merge conflicts",
      );
      failed.push({ featureId, revisionVersion, reason: "merge-conflict" });
      break;
    }

    if (!mergeResultHasChanges(mergeResult)) {
      logger.info(
        { experimentId: experiment.id, featureId, revisionVersion },
        "Discarding no-op pending feature draft on experiment start",
      );
      await discardRevision(context, revision, context.auditUser);
      await removePendingFeatureDraftFromExperiment(
        context,
        experiment.id,
        featureId,
        revisionVersion,
      );
      continue;
    }

    try {
      await publishRevision({
        context,
        feature,
        revision,
        result: mergeResult.result,
        comment: `Experiment "${experiment.name}" started`,
        bypassLockdown,
      });
      // Belt-and-suspenders: publishRevision's sweep keys off the revision's
      // own experiment-ref rules and would miss entries if those were deleted
      // pre-publish.
      await removePendingFeatureDraftFromExperiment(
        context,
        experiment.id,
        featureId,
        revisionVersion,
      );
      published.push({ featureId, revisionVersion });
      publishedFeatureIds.add(featureId);
    } catch (err) {
      logger.error(
        { err, experimentId: experiment.id, featureId, revisionVersion },
        "Failed to auto-publish pending feature draft on experiment start",
      );
      failed.push({ featureId, revisionVersion, reason: "publish-error" });
      break;
    }
  }

  return { published, failed };
}

export async function publishPendingFeatureDraftsForContextualBandit(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<PendingDraftPublishResult> {
  const drafts = cb.pendingFeatureDrafts ?? [];
  if (!drafts.length) return { published: [], failed: [] };

  const orgEnvIds = context.environments;
  const failed: PendingDraftFailure[] = [];
  const ready: ResolvedDraft[] = [];
  const cbModel = context.models.contextualBandits;

  for (const { featureId, revisionVersion } of drafts) {
    const feature = await getFeature(context, featureId);
    if (!feature) {
      await cbModel.removePendingFeatureDraft(
        cb.id,
        featureId,
        revisionVersion,
      );
      continue;
    }

    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: revisionVersion,
    });
    if (
      !revision ||
      revision.status === "published" ||
      revision.status === "discarded"
    ) {
      await cbModel.removePendingFeatureDraft(
        cb.id,
        featureId,
        revisionVersion,
      );
      continue;
    }

    const { base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision,
    });
    const requiresReview = checkIfRevisionNeedsReview({
      feature,
      baseRevision: base,
      revision,
      allEnvironments: context.environments,
      settings: context.org.settings,
      requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    });
    if (requiresReview && revision.status !== "approved") {
      logger.warn(
        { contextualBanditId: cb.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: approval required but not yet approved",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-approval" });
      continue;
    }

    ready.push({ featureId, revisionVersion });
  }

  if (failed.length > 0) {
    return { published: [], failed };
  }

  ready.sort(
    (a, b) =>
      a.featureId.localeCompare(b.featureId) ||
      a.revisionVersion - b.revisionVersion,
  );

  const published: ResolvedDraft[] = [];

  for (const { featureId, revisionVersion } of ready) {
    const feature = await getFeature(context, featureId);
    if (!feature) continue;
    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: revisionVersion,
    });
    if (
      !revision ||
      revision.status === "published" ||
      revision.status === "discarded"
    ) {
      continue;
    }

    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision,
    });
    const mergeResult = autoMerge(live, base, revision, orgEnvIds, {});
    if (!mergeResult.success) {
      logger.warn(
        {
          contextualBanditId: cb.id,
          featureId,
          revisionVersion,
          conflicts: mergeResult.conflicts,
        },
        "Cannot auto-publish pending feature draft due to merge conflicts",
      );
      failed.push({ featureId, revisionVersion, reason: "merge-conflict" });
      break;
    }

    try {
      await publishRevision({
        context,
        feature,
        revision,
        result: mergeResult.result,
        comment: `Contextual Bandit "${cb.name}" started`,
      });
      await cbModel.removePendingFeatureDraft(
        cb.id,
        featureId,
        revisionVersion,
      );
      published.push({ featureId, revisionVersion });
    } catch (err) {
      logger.error(
        { err, contextualBanditId: cb.id, featureId, revisionVersion },
        "Failed to auto-publish pending feature draft on CB start",
      );
      failed.push({ featureId, revisionVersion, reason: "publish-error" });
      break;
    }
  }

  return { published, failed };
}
