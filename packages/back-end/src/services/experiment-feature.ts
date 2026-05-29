import isEqual from "lodash/isEqual";
import {
  autoMerge,
  getMatchingRules,
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
  user,
  orgSettings,
}: {
  context: ReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
  updatedVariationValues: ExperimentRefVariation[];
  user: EventUser;
  orgSettings?: OrganizationSettings;
}): Promise<FeatureRevisionInterface> {
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
    { variations: updatedVariationValues },
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
  const approvalIds = ids("needs-approval");
  const errorIds = ids("publish-error");

  const plural = failed.length > 1 ? "s" : "";
  const parts: string[] = [];
  if (conflictIds.length) {
    parts.push(
      `merge conflict${conflictIds.length > 1 ? "s" : ""} in: ${conflictIds.join(", ")}`,
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

// Auto-publishes pendingFeatureDrafts on experiment start. Phase 1 prunes
// stale entries and gates on approval; Phase 2 publishes sequentially,
// re-merging each draft against fresh live state since earlier publishes
// may have advanced feature.version. Halts on the first merge conflict or
// publish error so the caller can abort the experiment transition.
export async function publishPendingFeatureDraftsForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  bypassLockdown = false,
): Promise<PendingDraftPublishResult> {
  const drafts = experiment.pendingFeatureDrafts ?? [];
  if (!drafts.length) return { published: [], failed: [] };

  const orgEnvIds = context.environments;
  const failed: PendingDraftFailure[] = [];
  const ready: ResolvedDraft[] = [];

  // ── Phase 1: prune stale + gate on approval ──────────────────────────────
  for (const { featureId, revisionVersion } of drafts) {
    const feature = await getFeature(context, featureId);
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
        { experimentId: experiment.id, featureId, revisionVersion },
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

  // ── Phase 2: sequential publish, re-merging each against fresh live ──────
  // Ascending version per feature so each merge builds on the previous publish.
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
