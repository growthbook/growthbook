import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import {
  DRAFT_REVISION_STATUSES,
  AutoMergeResult,
  checkIfRevisionNeedsReview,
  getEffectiveRevisionHoldout,
  getMatchingRules,
  isRevisionEditLockedBySchedule,
  liveRevisionFromFeature,
  MatchingRule,
  mergeResultHasChanges,
} from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { EventUser } from "shared/types/events/event-types";
import { Variation } from "shared/types/experiment";
import {
  ContextualBanditInterface,
  ExperimentInterface,
  ExperimentRefRule,
  ExperimentRefVariation,
  ExperimentRuleEnvironments,
  FeatureInterface,
  FeatureRule,
} from "shared/validators";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ApiReqContext } from "back-end/types/api";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/util/organization.util";
import {
  assessRevisionApproval,
  flagBypass,
  mergeDraftForAutoPublish,
} from "back-end/src/services/featurePublishGates";
import {
  addLinkedExperiment,
  editFeatureRules,
  getFeature,
  getFeatureProjectsByIds,
  prevalidatePublishRevision,
  publishRevision,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getFeatureRevisionsByStatus,
  getLinkageSyncRevisionSummaries,
  getRevision,
  initialRevision,
  prepareFeatureRevision,
  prevalidateRevisionUpdate,
  RevisionContentChangedError,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { customHooksActive } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  draftTakesRuleOut,
  getLaunchDraftVersion,
} from "back-end/src/util/featureExperimentSync";
import {
  addLinkedFeatureToExperiment,
  addPendingFeatureDraftToExperiment,
  removePendingFeatureDraftFromExperiment,
  setPendingFeatureUnlink,
  unlinkFeatureFromExperiment,
} from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { resolveHoldoutExperimentToLink } from "back-end/src/services/holdouts";
import {
  enableFootprintEnvironments,
  resolveLinkTargetVersion,
  scopeLinkedRefRule,
} from "back-end/src/util/revisionRuleOps";
import {
  assertValidRuleWrite,
  discardIfJustCreated,
  withStagedSchema,
} from "back-end/src/api/features/validations";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import { BadRequestError } from "back-end/src/util/errors";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  assertCanAutoPublish,
  generateRuleId,
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
  getLiveRevisionForFeature,
} from "back-end/src/services/features";
import { assertConfigBackedFeatureValuesValid } from "back-end/src/services/configValidation";
import { assertScheduledStartAllows } from "back-end/src/services/experimentChanges/scheduledStartLock";
import { assertFeatureNotLockedByRamp } from "back-end/src/services/rampSchedule";

type ExperimentFeatureLinkResult = {
  version: number;
  published: boolean;
};

type ExperimentFeatureLinkOptions = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  feature: FeatureInterface;
  rule: ExperimentRefRule;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  autoPublish?: boolean;
  draftVersion?: number;
  forceNewDraft?: boolean;
};

type ExperimentFeatureLinkCheck = Omit<
  ExperimentFeatureLinkOptions,
  "eventAudit" | "audit"
>;

// `experiment` may be the state a save leaves it in, e.g. with a variation the
// same save adds.
export async function assertFlagLinkable({
  context,
  experiment,
  feature,
  rule,
  autoPublish,
  draftVersion,
  forceNewDraft,
}: ExperimentFeatureLinkCheck): Promise<{
  scopedRule: FeatureRule;
  ruleEnvFootprint: string[];
  targetVersion: number;
  target: FeatureRevisionInterface | null;
}> {
  const { environments } = context;

  if (
    rule.type !== "experiment-ref" ||
    rule.experimentId !== experiment.id ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid experiment rule");
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }

  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  assertScheduledStartAllows(experiment, "linked Feature Flags");

  const targetVersion = resolveLinkTargetVersion(feature, {
    autoPublish,
    draftVersion,
    forceNewDraft,
  });
  // Null when the rule lands on a new draft cut from live.
  const target =
    targetVersion === feature.version
      ? null
      : await getRevision({
          context,
          organization: context.org.id,
          featureId: feature.id,
          feature,
          version: targetVersion,
        });

  const scopedRule = scopeLinkedRefRule(
    { ...rule, id: generateRuleId() } as FeatureRule,
    environments,
  );

  await assertValidRuleWrite(
    context,
    withStagedSchema(feature, target),
    scopedRule,
    undefined,
    [experiment],
  );
  const ruleEnvFootprint = scopedRule.allEnvironments
    ? environments
    : (scopedRule.environments ?? []);

  // Landing authority only when this call lands.
  if (
    autoPublish &&
    !context.permissions.canPublishFeature(feature, ruleEnvFootprint)
  ) {
    context.permissions.throwPermissionError();
  }

  // Same schema + invariants as a REST publish; no-op unless config-backed JSON.
  await assertConfigBackedFeatureValuesValid(context, feature, {
    rules: [scopedRule],
  });

  // A draft cut from live carries live's holdout.
  await resolveHoldoutExperimentToLink({
    context,
    feature,
    experiment,
    effectiveHoldout: getEffectiveRevisionHoldout(target ?? {}, feature),
  });

  return { scopedRule, ruleEnvFootprint, targetVersion, target };
}

// Runs the validation hooks on the draft this link would write, before the
// save writes anything; linking runs them again. `unsaved`: a flag the same
// save creates.
export async function prevalidateFlagLink(
  check: ExperimentFeatureLinkCheck,
  { unsaved = false }: { unsaved?: boolean } = {},
): Promise<void> {
  const { scopedRule, ruleEnvFootprint, target } =
    await assertFlagLinkable(check);
  const { context, feature } = check;
  if (!customHooksActive(context)) return;
  const user = context.auditUser;
  const environments = getEnvironmentIdsFromOrg(context.org);
  // Cut from live as getDraftRevision cuts one, so by whoever is saving.
  const draft =
    target ??
    (
      await prepareFeatureRevision({
        context,
        feature,
        user,
        environments,
        baseVersion: feature.version,
        ...(unsaved && {
          unsavedLive: initialRevision(feature, user, environments),
        }),
      })
    ).revision;
  await prevalidateRevisionUpdate(
    context,
    feature,
    draft,
    linkDraftChanges(
      context.environments,
      feature,
      draft,
      scopedRule,
      ruleEnvFootprint,
    ),
  );
}

function linkDraftChanges(
  environments: string[],
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  scopedRule: FeatureRule,
  footprint: string[],
): Partial<FeatureRevisionInterface> {
  const environmentsEnabled = enableFootprintEnvironments(
    feature,
    revision,
    environments,
    footprint,
  );
  return {
    rules: [...cloneDeep(revision.rules ?? []), scopedRule],
    ...(environmentsEnabled && { environmentsEnabled }),
  };
}

// Stage (or land) an experiment-ref rule. Mirrors `linkFeatureToContextualBandit`.
export async function linkFeatureToExperiment({
  context,
  experiment,
  feature,
  rule,
  eventAudit,
  audit,
  autoPublish,
  draftVersion,
  forceNewDraft,
}: ExperimentFeatureLinkOptions): Promise<ExperimentFeatureLinkResult> {
  const { environments } = context;
  const { scopedRule, ruleEnvFootprint, targetVersion } =
    await assertFlagLinkable({
      context,
      experiment,
      feature,
      rule,
      autoPublish,
      draftVersion,
      forceNewDraft,
    });

  // A draft opened off live is this call's to discard if it can't finish.
  const created = targetVersion === feature.version;
  const revision = await getDraftRevision(context, feature, targetVersion);

  const combinedChanges = linkDraftChanges(
    environments,
    feature,
    revision,
    scopedRule,
    ruleEnvFootprint,
  );
  // Title fresh drafts only — don't clobber a user's title on an existing draft.
  const bundlingIntoExistingDraft =
    !!draftVersion && !forceNewDraft && !autoPublish;
  if (!bundlingIntoExistingDraft && !revision.title) {
    combinedChanges.title =
      experiment.type === "multi-armed-bandit"
        ? "Add Bandit"
        : "Add experiment";
  }

  const auditSubject = scopedRule.allEnvironments
    ? "to all environments"
    : `to ${ruleEnvFootprint.join(", ") || "no environments"}`;
  let updatedRevision = revision;
  let updatedFeature: FeatureInterface | null = null;
  try {
    updatedRevision =
      (await updateRevision(context, feature, revision, combinedChanges, {
        user: eventAudit,
        action: "add experiment rule",
        subject: auditSubject,
        value: JSON.stringify(scopedRule),
      })) ?? revision;
    await recordRevisionUpdate(context, feature, updatedRevision, "rule.add", {
      environments: ruleEnvFootprint,
    });
    if (autoPublish) {
      await assertCanAutoPublish(context, feature, updatedRevision);
      updatedFeature = await mergeAndPublishRevision({
        context,
        feature,
        revision: updatedRevision,
        comment: `Add experiment rule for "${experiment.name}"`,
        bypassLockdown: flagBypass(context, feature, { optIn: true }).lockdown,
        conflictMessage: `Unable to auto-publish: please resolve conflicts on draft #${updatedRevision.version} before publishing.`,
      });
    }
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }

  let published = false;
  if (updatedFeature) {
    await audit({
      event: "feature.publish",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: updatedRevision.version,
        comment: `Add experiment rule for "${experiment.name}"`,
      }),
    });
    published = true;
  } else {
    // Queue the draft for auto-publish on `status -> running`.
    await addPendingFeatureDraftToExperiment(
      context,
      rule.experimentId,
      feature.id,
      updatedRevision.version,
    );
  }

  if (!feature.linkedExperiments?.includes(experiment.id)) {
    await addLinkedExperiment(feature, experiment.id);
  }
  await addLinkedFeatureToExperiment(
    context,
    rule.experimentId,
    feature.id,
    experiment,
  );

  return { version: updatedRevision.version, published };
}

async function mergeAndPublishRevision({
  context,
  feature,
  revision,
  comment,
  bypassLockdown,
  conflictMessage,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  comment: string;
  bypassLockdown: boolean;
  conflictMessage: string;
}) {
  const mergeResult = await mergeOntoLive(context, feature, revision);
  if (!mergeResult.success) throw new Error(conflictMessage);
  return publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    bypassLockdown,
  });
}

async function mergeOntoLive(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
) {
  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
  return mergeDraftForAutoPublish(context, feature, revision, live, base)
    .mergeResult;
}

export type ExperimentFeatureUpdatePlan = {
  feature: FeatureInterface;
  existingRevision?: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
};

export type ExperimentLinkedFeatureValueUpdate = {
  variations: ExperimentRefVariation[];
  // JSON only: values are partial objects merged onto the default. Omitted keeps
  // the rule's own sparse flag.
  sparse?: boolean;
  // Omitted leaves the rule's environments as they are.
  environments?: ExperimentRuleEnvironments;
  // Omitted means all of the experiment's rules.
  ruleIds?: string[];
  // Null starts a new draft off live.
  targetVersion: number | null;
};

// One flag's values against the experiment's variations and weights.
export function validateExperimentFeatureVariations({
  variations,
  variationWeights,
  experimentType,
  featureId,
  update,
}: {
  variations: Variation[];
  variationWeights: number[];
  experimentType: ExperimentInterface["type"];
  featureId: string;
  update: Pick<ExperimentLinkedFeatureValueUpdate, "variations">;
}) {
  // A bandit sets its own weights, so they don't gate its values.
  if (experimentType !== "multi-armed-bandit") {
    if (variations.length !== variationWeights.length) {
      throw new Error(
        "variations and variationWeights must be the same length.",
      );
    }
  }
  if (update.variations.length !== variations.length) {
    throw new Error("All features must specify values for all variations.");
  }
  update.variations.forEach((refVariation, i) => {
    const expectedVariationId = variations[i]?.id;
    if (!expectedVariationId) {
      throw new Error(
        `Variation at index ${i} is missing an id; ensure variations are normalized before validation.`,
      );
    }
    if (refVariation.variationId !== expectedVariationId) {
      throw new Error(
        `Feature ${featureId}: experiment ref variation at index ${i} must use variationId "${expectedVariationId}".`,
      );
    }
  });
}

export async function updateExperimentRefVariations({
  context,
  feature,
  revision,
  matchingRules,
  updatedVariationValues,
  sparse,
  ruleUpdates,
  user,
}: {
  context: ReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
  updatedVariationValues: ExperimentRefVariation[];
  sparse?: boolean;
  // Other rule fields written with the values, e.g. its environment scope.
  ruleUpdates?: Partial<ExperimentRefRule>;
  user: EventUser;
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
      ...ruleUpdates,
      variations: updatedVariationValues,
      ...(sparse !== undefined && { sparse }),
    },
    user,
    { guardDateUpdated: true },
  );

  if (!updatedRevision) {
    throw new Error(
      `Failed to update experiment ref variations for feature ${feature.id} on the draft revision`,
    );
  }

  return updatedRevision;
}

function sameRuleEnvironments(
  rule: Pick<ExperimentRefRule, "allEnvironments" | "environments">,
  scope: ExperimentRuleEnvironments,
): boolean {
  if (!!rule.allEnvironments !== scope.allEnvironments) return false;
  if (scope.allEnvironments) return true;
  return isEqual(
    [...(rule.environments ?? [])].sort(),
    [...scope.environments].sort(),
  );
}

// Null when the flag already holds these values.
export async function validateExperimentFeatureUpdate({
  experiment,
  feature,
  update,
  context,
}: {
  experiment: ExperimentInterface;
  feature: FeatureInterface;
  update: ExperimentLinkedFeatureValueUpdate;
  context: ReqContext;
}): Promise<ExperimentFeatureUpdatePlan | null> {
  const { targetVersion } = update;
  const revision =
    targetVersion !== null
      ? await getDraftRevision(context, feature, targetVersion)
      : await getLiveRevisionForFeature(context, feature);

  const onlyRuleIds = update.ruleIds;
  const matchingRules = getMatchingRules(
    feature,
    (r: FeatureRule) =>
      r.type === "experiment-ref" &&
      r.experimentId === experiment.id &&
      (!onlyRuleIds || onlyRuleIds.includes(r.id)),
    context.environments,
    revision,
  );

  if (!matchingRules.length)
    throw new Error(
      `No experiment-ref rules found for this experiment on feature ${feature.id}, version ${revision.version}`,
    );
  if (onlyRuleIds?.some((id) => !matchingRules.some((m) => m.rule.id === id))) {
    throw new Error(
      `Feature ${feature.id}: one of the experiment's rules is no longer on version ${revision.version}.`,
    );
  }

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

  const featureNeedsUpdate = matchingRules.some((m: MatchingRule) => {
    if (m.rule.type !== "experiment-ref") return false;
    return (
      !isEqual(m.rule.variations, update.variations) ||
      (update.sparse !== undefined && update.sparse !== !!m.rule.sparse) ||
      (!!update.environments &&
        !sameRuleEnvironments(m.rule, update.environments))
    );
  });
  if (!featureNeedsUpdate) return null;

  return {
    feature,
    existingRevision: targetVersion !== null ? revision : undefined,
    matchingRules,
  };
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
// The live revision is both the merge baseline and the review baseline; any
// ramp actions on the draft are judged by the shared assessment like any other.
export async function assessRevisionApprovalForAutoPublish(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  live: FeatureRevisionInterface,
  base: FeatureRevisionInterface,
  mergeResult: AutoMergeResult,
) {
  const filledLive = { ...live, ...liveRevisionFromFeature(live, feature) };
  return assessRevisionApproval({
    context,
    feature,
    revision,
    // What will land, not the raw draft: a diverged live moves the answer.
    effectiveRevision: mergeResult.success
      ? {
          ...filledLive,
          ...mergeResult.result,
          rampActions: revision.rampActions,
        }
      : revision,
    filledLive,
    base,
  });
}

type ReadyDraft = ResolvedDraft & {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  mergeResult: AutoMergeResult;
  bypassLockdown: boolean;
};

// The one draft per linked flag that starting the experiment publishes.
export async function getLaunchDrafts(
  context: ReqContext | ApiReqContext,
  experiment: Pick<ExperimentInterface, "id" | "pendingFeatureDrafts">,
): Promise<ResolvedDraft[]> {
  const launches: ResolvedDraft[] = [];
  const featureIds = new Set(
    (experiment.pendingFeatureDrafts ?? []).map((d) => d.featureId),
  );
  for (const featureId of featureIds) {
    const { openDrafts, liveRevision } = await getLinkageSyncRevisionSummaries(
      context.org.id,
      featureId,
    );
    const launch = getLaunchDraftVersion(
      experiment.id,
      openDrafts,
      liveRevision,
    );
    if (launch !== null) launches.push({ featureId, revisionVersion: launch });
  }
  return launches;
}

// Publishes one draft per linked feature on experiment start, halting on the
// first merge conflict or publish error so the caller can abort the start.
export async function publishPendingFeatureDraftsForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  bypassLockdown = false,
  restApiBypassesReviews = false,
): Promise<PendingDraftPublishResult> {
  const queued = experiment.pendingFeatureDrafts ?? [];
  if (!queued.length) return { published: [], failed: [] };

  // ── Phase 0: exactly one draft per feature ────────────────────────────────
  const drafts = await getLaunchDrafts(context, experiment);
  for (const entry of queued) {
    const launches = drafts.some(
      (d) =>
        d.featureId === entry.featureId &&
        d.revisionVersion === entry.revisionVersion,
    );
    if (launches) continue;
    await removePendingFeatureDraftFromExperiment(
      context,
      experiment.id,
      entry.featureId,
      entry.revisionVersion,
    );
  }
  if (!drafts.length) return { published: [], failed: [] };

  const failed: PendingDraftFailure[] = [];
  const ready: ReadyDraft[] = [];

  // ── Phase 1: prune stale + gate on approval + merge against live ─────────
  for (const { featureId, revisionVersion } of drafts) {
    const feature = await getFeature(context, featureId);
    if (!feature) {
      // Pruned only when deleted; unreadable fails the start.
      if (
        (await getFeatureProjectsByIds(context, [featureId])).has(featureId)
      ) {
        failed.push({ featureId, revisionVersion, reason: "publish-error" });
        continue;
      }
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
    const { mergeResult, rebaseRequired } = mergeDraftForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
    );
    // Re-derived per feature: the caller's opt-in is not authority on its own.
    const { approval: bypassApproval, lockdown: bypassFlagLockdown } =
      flagBypass(context, feature, {
        optIn: bypassLockdown,
        restApiBypassesReviews,
      });
    // Refused before anything publishes rather than partway through.
    if (!bypassFlagLockdown) {
      await assertFeatureNotLockedByRamp(context, featureId);
    }
    // The same question the publish button and the REST endpoint ask, so an
    // autostart can never land a draft either of those would refuse.
    const approval = await assessRevisionApprovalForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
      mergeResult,
    );
    if (!approval.satisfied && !bypassApproval) {
      logger.warn(
        {
          experimentId: experiment.id,
          featureId,
          revisionVersion,
          status: revision.status,
          hasCoveringApproval: approval.hasCoveringApproval,
          requiredTeamsSatisfied: approval.requiredApproverTeams.satisfied,
          requiredProjectApproversSatisfied:
            approval.requiredProjectApprovers.satisfied,
        },
        "Cannot auto-publish pending feature draft: approval requirements not met",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-approval" });
      continue;
    }

    if (rebaseRequired && !bypassApproval) {
      logger.warn(
        { experimentId: experiment.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: rebase with live required before publishing",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-rebase" });
      continue;
    }
    ready.push({
      featureId,
      revisionVersion,
      feature,
      revision,
      mergeResult,
      bypassLockdown: bypassFlagLockdown,
    });
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

  // ── Phase 2: publish ──────────────────────────────────────────────────────
  const published: ResolvedDraft[] = [];

  for (const {
    featureId,
    revisionVersion,
    feature,
    revision,
    mergeResult,
    bypassLockdown: bypassFlagLockdown,
  } of ready) {
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
      try {
        await discardRevision(
          context,
          revision,
          context.auditUser,
          feature.version,
        );
      } catch (err) {
        logger.error(
          { err, experimentId: experiment.id, featureId, revisionVersion },
          "Failed to discard no-op pending feature draft on experiment start",
        );
        failed.push({ featureId, revisionVersion, reason: "publish-error" });
        break;
      }
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
        bypassLockdown: bypassFlagLockdown,
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

export async function publishPendingFeatureDraftsForContextualBandit(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<PendingDraftPublishResult> {
  const drafts = cb.pendingFeatureDrafts ?? [];
  if (!drafts.length) return { published: [], failed: [] };

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

    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision,
    });
    const { mergeResult, rebaseRequired } = mergeDraftForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
    );
    const approval = await assessRevisionApprovalForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
      mergeResult,
    );
    if (!approval.satisfied) {
      logger.warn(
        {
          contextualBanditId: cb.id,
          featureId,
          revisionVersion,
          status: revision.status,
          hasCoveringApproval: approval.hasCoveringApproval,
          requiredTeamsSatisfied: approval.requiredApproverTeams.satisfied,
          requiredProjectApproversSatisfied:
            approval.requiredProjectApprovers.satisfied,
        },
        "Cannot auto-publish pending feature draft: approval requirements not met",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-approval" });
      continue;
    }
    if (rebaseRequired) {
      logger.warn(
        { contextualBanditId: cb.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: rebase with live required before publishing",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-rebase" });
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
    const { mergeResult, rebaseRequired } = mergeDraftForAutoPublish(
      context,
      feature,
      revision,
      live,
      base,
    );
    if (rebaseRequired) {
      logger.warn(
        { contextualBanditId: cb.id, featureId, revisionVersion },
        "Cannot auto-publish pending feature draft: rebase with live required after an earlier publish advanced the feature",
      );
      failed.push({ featureId, revisionVersion, reason: "needs-rebase" });
      break;
    }
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

// The rule's own environment fields, and the flag environments it switches on.
export function planExperimentRuleEnvironments({
  feature,
  revision,
  experimentId,
  orgEnvironments,
  scope,
}: {
  feature: FeatureInterface;
  revision: Pick<FeatureRevisionInterface, "rules" | "environmentsEnabled">;
  experimentId: string;
  orgEnvironments: string[];
  scope: ExperimentRuleEnvironments;
}): {
  scopedEnvironments: string[];
  ruleUpdate: Partial<ExperimentRefRule>;
  environmentsEnabled: Record<string, boolean> | null;
} {
  const scopedEnvironments = scope.allEnvironments
    ? orgEnvironments
    : scope.environments.filter((e) => orgEnvironments.includes(e));
  const hasRule = (revision.rules ?? []).some(
    (rule) =>
      rule.type === "experiment-ref" && rule.experimentId === experimentId,
  );
  if (!hasRule) {
    throw new BadRequestError(
      `No experiment rule found on "${feature.id}" to re-scope. It may have been removed.`,
    );
  }
  // A rule in no environment serves nothing and drops off the experiment's page.
  if (!scopedEnvironments.length) {
    throw new BadRequestError(
      `Choose at least one environment for the experiment's rule on "${feature.id}", or remove the Feature Flag from the experiment.`,
    );
  }
  return {
    scopedEnvironments,
    // Strips any stale environments[], as linking does.
    ruleUpdate: scope.allEnvironments
      ? { allEnvironments: true, environments: undefined }
      : { allEnvironments: false, environments: scopedEnvironments },
    environmentsEnabled: enableFootprintEnvironments(
      feature,
      revision,
      orgEnvironments,
      scopedEnvironments,
    ),
  };
}

const experimentRuleFor =
  (experimentId: string) =>
  (r: FeatureRule): r is ExperimentRefRule =>
    r.type === "experiment-ref" && r.experimentId === experimentId;

const openDraftsOf = (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) =>
  getFeatureRevisionsByStatus({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    status: DRAFT_REVISION_STATUSES,
    skipPagination: true,
  });

// Whether the flag serves the experiment, or will once its launch draft
// publishes; a draft carrying the rule unchanged from its base doesn't add it.
export async function flagHoldsExperimentRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  experimentId: string,
): Promise<boolean> {
  if (holdsRule(experimentRuleFor(experimentId))(feature.rules)) return true;
  const { openDrafts, liveRevision } = await getLinkageSyncRevisionSummaries(
    context.org.id,
    feature.id,
  );
  return getLaunchDraftVersion(experimentId, openDrafts, liveRevision) !== null;
}

// Guarded, and retried from a fresh read, so an edit landing in between is
// kept; a draft published or discarded meanwhile is never written.
async function updateDraftRules(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
  changes: (rules: FeatureRule[]) => Parameters<typeof updateRevision>[3],
  log: Parameters<typeof updateRevision>[4],
): Promise<FeatureRevisionInterface> {
  let current = draft;
  for (let attempt = 1; ; attempt++) {
    try {
      return await updateRevision(
        context,
        feature,
        current,
        changes(current.rules ?? []),
        log,
        { guardDateUpdated: true },
      );
    } catch (e) {
      if (!(e instanceof RevisionContentChangedError) || attempt >= 3) throw e;
      const fresh = await getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: current.version,
      });
      if (!fresh || !DRAFT_REVISION_STATUSES.includes(fresh.status)) throw e;
      current = fresh;
    }
  }
}

// Rewrites the experiment's rules in every open draft of the flag holding one,
// returning those drafts as they were.
async function rewriteExperimentRulesInDrafts({
  context,
  feature,
  refersToExperiment,
  rewrite,
  logEntry,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  refersToExperiment: (r: FeatureRule) => boolean;
  rewrite: (rules: FeatureRule[], featureId: string) => FeatureRule[];
  logEntry: (touched: FeatureRule[]) => Parameters<typeof updateRevision>[4];
}): Promise<FeatureRevisionInterface[]> {
  const rewritten: FeatureRevisionInterface[] = [];
  for (const draft of await openDraftsOf(context, feature)) {
    const touched = (draft.rules ?? []).filter(refersToExperiment);
    if (!touched.length) continue;
    await updateDraftRules(
      context,
      feature,
      draft,
      (rules) => ({ rules: rewrite(rules, feature.id) }),
      logEntry(touched),
    );
    rewritten.push(draft);
  }
  return rewritten;
}

// The revision a draft was cut from, or null where it can't be found.
const draftBase = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  draft: FeatureRevisionInterface,
) =>
  draft.baseVersion === feature.version
    ? feature
    : getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: draft.baseVersion,
      });

const holdsRule =
  (refersToExperiment: (r: FeatureRule) => boolean) =>
  (rules: FeatureRule[] | undefined) =>
    (rules ?? []).some(refersToExperiment);

// The open drafts taking a live rule out, which keeping the flag restores.
async function draftsTakingRuleOut(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  refersToExperiment: (r: FeatureRule) => boolean,
): Promise<FeatureRevisionInterface[]> {
  const hasRule = holdsRule(refersToExperiment);
  if (!hasRule(feature.rules)) return [];
  const out: FeatureRevisionInterface[] = [];
  for (const draft of await openDraftsOf(context, feature)) {
    if (hasRule(draft.rules)) continue;
    if (
      draftTakesRuleOut(
        hasRule,
        draft,
        await draftBase(context, feature, draft),
      )
    ) {
      out.push(draft);
    }
  }
  return out;
}

function assertDraftsEditable(drafts: FeatureRevisionInterface[]) {
  const locked = drafts.find(isRevisionEditLockedBySchedule);
  if (locked) {
    throw new BadRequestError(
      `Revision ${locked.version} of Feature Flag "${locked.featureId}" is locked for a scheduled publish. Cancel its schedule first.`,
    );
  }
}

// Returns the open drafts holding the rule.
async function assertDraftsWithRuleEditable(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  refersToExperiment: (r: FeatureRule) => boolean,
): Promise<FeatureRevisionInterface[]> {
  const hasRule = holdsRule(refersToExperiment);
  const drafts = (await openDraftsOf(context, feature)).filter((d) =>
    hasRule(d.rules),
  );
  assertDraftsEditable(drafts);
  return drafts;
}

const removalLog =
  (experiment: ExperimentInterface, eventAudit: EventUser, action: string) =>
  (touched: FeatureRule[]) => ({
    user: eventAudit,
    action,
    subject: `for experiment "${experiment.name}"`,
    value: JSON.stringify(touched),
  });

const removalTitle = (experiment: ExperimentInterface) =>
  `Remove from experiment "${experiment.name}"`;

export async function assertFlagRemovable(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
): Promise<void> {
  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  assertScheduledStartAllows(experiment, "linked Feature Flags");
  const refersToExperiment = experimentRuleFor(experiment.id);
  await assertDraftsWithRuleEditable(context, feature, refersToExperiment);
  if (experiment.status !== "running") return;
  // A draft only carrying an old copy adds nothing, so it doesn't hold it here.
  const { openDrafts, liveRevision } = await getLinkageSyncRevisionSummaries(
    context.org.id,
    feature.id,
  );
  if (
    (feature.rules ?? []).some(refersToExperiment) ||
    getLaunchDraftVersion(experiment.id, openDrafts, liveRevision) !== null
  ) {
    throw new BadRequestError(
      "Set the experiment's status back to draft to remove this Feature Flag.",
    );
  }
}

export async function assertFlagKeepable(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
): Promise<void> {
  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  if (!experiment.pendingFeatureUnlinks?.includes(feature.id)) {
    throw new BadRequestError(
      `Feature Flag "${feature.id}" is not being removed from this experiment, so there is nothing to keep.`,
    );
  }
  assertDraftsEditable(
    await draftsTakingRuleOut(
      context,
      feature,
      experimentRuleFor(experiment.id),
    ),
  );
}

// Open drafts lose the rule now; a live rule leaves through a draft, and the
// flag unlinks once nothing live or open has it (settlePendingFeatureUnlinks).
export async function removeFlagFromExperiment({
  context,
  experiment,
  featureId,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  featureId: string;
  eventAudit: EventUser;
}): Promise<void> {
  const feature = await getFeature(context, featureId);
  if (!feature) {
    // Only a flag that's gone is pruned unseen; one the caller can't read isn't.
    if ((await getFeatureProjectsByIds(context, [featureId])).has(featureId)) {
      context.permissions.throwPermissionError();
    }
    await unlinkFeatureFromExperiment(context, experiment.id, featureId);
    return;
  }
  await assertFlagRemovable(context, experiment, feature);
  const refersToExperiment = experimentRuleFor(experiment.id);
  const drop = (rules: FeatureRule[]) =>
    rules.filter((r) => !refersToExperiment(r));
  const logEntry = removalLog(experiment, eventAudit, "remove experiment rule");
  const rewritten = await rewriteExperimentRulesInDrafts({
    context,
    feature,
    refersToExperiment,
    rewrite: drop,
    logEntry,
  });
  const liveTouched = (feature.rules ?? []).filter(refersToExperiment);
  if (!liveTouched.length) {
    await unlinkFeatureFromExperiment(context, experiment.id, featureId);
    return;
  }
  // A stripped draft takes the live rule out only if its base had it; a
  // draft that added its own copy over a base without one doesn't.
  const hasRule = holdsRule(refersToExperiment);
  let covered = false;
  for (const draft of rewritten) {
    if (
      draftTakesRuleOut(
        hasRule,
        { rules: drop(draft.rules ?? []) },
        await draftBase(context, feature, draft),
      )
    ) {
      covered = true;
      break;
    }
  }
  if (!covered) {
    const draft = await getDraftRevision(context, feature, feature.version);
    await updateRevision(
      context,
      feature,
      draft,
      { rules: drop(draft.rules ?? []), title: removalTitle(experiment) },
      logEntry(liveTouched),
    );
  }
  await setPendingFeatureUnlink(context, experiment.id, featureId, true);
}

// An edit back to what serves must not leave an empty review behind.
async function discardDraftIfNoop({
  context,
  feature,
  revision,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  eventAudit: EventUser;
}): Promise<void> {
  const mergeResult = await mergeOntoLive(context, feature, revision);
  if (!mergeResult.success || mergeResultHasChanges(mergeResult)) return;
  await discardRevision(context, revision, eventAudit, feature.version);
}

// Undoes a pending removal. The draft the removal started is discarded once it
// has nothing left to publish; a teammate's stays.
export async function keepFlagInExperiment({
  context,
  experiment,
  featureId,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  featureId: string;
  eventAudit: EventUser;
}): Promise<void> {
  const feature = await getFeature(context, featureId);
  if (!feature) {
    throw new BadRequestError(`Feature Flag ${featureId} not found`);
  }
  await assertFlagKeepable(context, experiment, feature);
  const refersToExperiment = experimentRuleFor(experiment.id);
  const live = feature.rules ?? [];
  const logEntry = removalLog(
    experiment,
    eventAudit,
    "restore experiment rule",
  );
  const withLiveRules = (draftRules: FeatureRule[]) => {
    const rules = [...draftRules];
    live.forEach((rule, i) => {
      if (!refersToExperiment(rule) || rules.some((r) => r.id === rule.id)) {
        return;
      }
      // After the nearest live rule before it that the draft still has, else
      // before the nearest after it.
      const ids = new Set(rules.map((r) => r.id));
      const prev = live
        .slice(0, i)
        .reverse()
        .find((r) => ids.has(r.id));
      const next = live.slice(i + 1).find((r) => ids.has(r.id));
      const at = prev
        ? rules.findIndex((r) => r.id === prev.id) + 1
        : next
          ? rules.findIndex((r) => r.id === next.id)
          : Math.min(i, rules.length);
      rules.splice(at, 0, rule);
    });
    return rules;
  };
  for (const draft of await draftsTakingRuleOut(
    context,
    feature,
    refersToExperiment,
  )) {
    const startedByRemoval = draft.title === removalTitle(experiment);
    const restored = await updateDraftRules(
      context,
      feature,
      draft,
      (rules) => ({
        rules: withLiveRules(rules),
        ...(startedByRemoval && { title: "" }),
      }),
      logEntry(live.filter(refersToExperiment)),
    );
    if (startedByRemoval) {
      await discardDraftIfNoop({
        context,
        feature,
        revision: restored,
        eventAudit,
      });
    }
  }
  await setPendingFeatureUnlink(context, experiment.id, featureId, false);
}

type CleanupArgs = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  features: FeatureInterface[];
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  restApiBypassesReviews?: boolean;
};

// Authority is checked for every flag before any write, and live lands before drafts.
async function resolveRulesForExperiment({
  context,
  experiment,
  features,
  eventAudit,
  audit,
  replacement,
  action,
  comment,
  restApiBypassesReviews = false,
}: CleanupArgs & {
  replacement: (
    rule: ExperimentRefRule,
    featureId: string,
  ) => FeatureRule | null;
  action: string;
  comment: string;
}): Promise<void> {
  const refersToExperiment = experimentRuleFor(experiment.id);
  const rewrite = (rules: FeatureRule[], featureId: string) =>
    rules.flatMap((r) => {
      if (!refersToExperiment(r)) return [r];
      const next = replacement(r, featureId);
      return next ? [next] : [];
    });
  const logEntry = removalLog(experiment, eventAudit, action);

  // Append-only for history, but a deleted experiment has none to show.
  const unlink = async (current: FeatureInterface) => {
    if (!current.linkedExperiments?.includes(experiment.id)) return;
    await updateFeature(
      context,
      current,
      {
        linkedExperiments: current.linkedExperiments.filter(
          (id) => id !== experiment.id,
        ),
      },
      { casOnDateUpdated: current.dateUpdated },
    );
  };
  // Only a write race can fail after the authority pass; flags already landed
  // stay landed, and a retry skips them.
  let landed = 0;
  const refuse = (feature: FeatureInterface, reason: string) =>
    new Error(
      `Could not update Feature Flag "${feature.id}": ${reason}. Ask someone who can publish that Feature Flag, or remove the experiment rule from it first.${
        landed
          ? ` ${landed} other linked Feature Flag${landed === 1 ? " was" : "s were"} already updated; retrying finishes the rest.`
          : ""
      }`,
    );

  const bypassFor = new Map<string, boolean>();
  for (const feature of features) {
    // A locked draft would refuse its rewrite after live has landed.
    const draftsWithRule = await assertDraftsWithRuleEditable(
      context,
      feature,
      refersToExperiment,
    );
    const liveHasRule = (feature.rules ?? []).some(refersToExperiment);
    // The cleanup rewrites the drafts of every flag holding the rule.
    if (
      (liveHasRule || draftsWithRule.length) &&
      !context.permissions.canEditFeatureDrafts(feature)
    ) {
      throw refuse(feature, "no authority to edit its drafts");
    }
    if (!liveHasRule) continue;
    const envs = Array.from(
      getEnabledEnvironments(feature, context.environments),
    );
    // Cleaning up after the experiment is the caller's own call to make.
    const bypass = flagBypass(context, feature, {
      optIn: true,
      restApiBypassesReviews,
    }).approval;
    // As publishing the rewrite would judge it: every project governing the
    // flag, and the environments the rewrite touches.
    const live = await getLiveRevisionForFeature(context, feature);
    const reviewRequired =
      !bypass &&
      checkIfRevisionNeedsReview({
        feature,
        baseRevision: live,
        revision: { ...live, rules: rewrite(live.rules ?? [], feature.id) },
        orgEnvironments: getEnvironments(context.org),
        settings: context.org.settings,
        requireApprovalsLicensed:
          context.hasPremiumFeature("require-approvals"),
      });
    if (
      !context.permissions.canPublishFeature(feature, envs) ||
      reviewRequired
    ) {
      throw refuse(feature, "no authority to publish the change");
    }
    bypassFor.set(feature.id, bypass);
  }

  for (const feature of features) {
    const liveTouched = (feature.rules ?? []).filter(refersToExperiment);
    let cleanupDraft: FeatureRevisionInterface | null = null;
    let current = feature;
    try {
      if (liveTouched.length) {
        const bypass = bypassFor.get(feature.id) ?? false;
        cleanupDraft = await getDraftRevision(
          context,
          feature,
          feature.version,
        );
        const updated =
          (await updateRevision(
            context,
            feature,
            cleanupDraft,
            {
              rules: rewrite(cleanupDraft.rules ?? [], feature.id),
              title: comment,
            },
            logEntry(liveTouched),
          )) ?? cleanupDraft;
        current = await mergeAndPublishRevision({
          context,
          feature,
          revision: updated,
          comment,
          bypassLockdown: bypass,
          conflictMessage: "the change did not merge cleanly onto live",
        });
        cleanupDraft = null;
        await audit({
          event: "feature.publish",
          entity: { object: "feature", id: feature.id },
          details: auditDetailsUpdate(feature, current, {
            revision: updated.version,
            comment,
          }),
        });
      }

      // Drafts only after live has landed: a refusal above then changes nothing.
      await rewriteExperimentRulesInDrafts({
        context,
        feature: current,
        refersToExperiment,
        rewrite,
        logEntry,
      });
      await unlink(current);
      landed += 1;
    } catch (e) {
      if (cleanupDraft) {
        await discardRevision(
          context,
          cleanupDraft,
          eventAudit,
          feature.version,
        ).catch((err) =>
          logger.error(
            { err, featureId: feature.id },
            "Failed to discard an experiment cleanup draft",
          ),
        );
      }
      throw refuse(feature, e instanceof Error ? e.message : String(e));
    }
  }
}

// The payload skips a missing experiment. Fails closed, before the experiment is deleted.
export async function removeRulesForDeletedExperiment({
  context,
  experiment,
  features,
  eventAudit,
  audit,
  restApiBypassesReviews,
}: CleanupArgs): Promise<void> {
  await resolveRulesForExperiment({
    context,
    experiment,
    features,
    eventAudit,
    audit,
    restApiBypassesReviews,
    replacement: () => null,
    action: "remove experiment rule",
    comment: `Remove rule for deleted experiment "${experiment.name}"`,
  });
}

// The permanent rule serving the temporary rollout's value, with the phase's
// targeting, to the same users.
export function keptExperimentRule(
  experiment: ExperimentInterface,
  rule: ExperimentRefRule,
  featureId: string,
): FeatureRule | null {
  const releasedId = experiment.releasedVariationId;
  const value = rule.variations.find(
    (v) => v.variationId === releasedId,
  )?.value;
  // The payload skips a rule whose released arm has no value, so dropping it
  // changes nothing.
  if (value === undefined) return null;
  const phase = experiment.phases[experiment.phases.length - 1];
  const coverage = phase?.coverage ?? 1;
  const released = experiment.variations.find((v) => v.id === releasedId);
  const kept = {
    // A sparse arm stays a patch over the default, as it was served; the
    // payload served the phase's targeting, never the rule's own.
    ...omit(rule, [
      "type",
      "experimentId",
      "variations",
      "condition",
      "savedGroups",
      "prerequisites",
    ]),
    value,
    description: `Released from experiment "${experiment.name}"${
      released ? ` (${released.name})` : ""
    }`,
    ...(phase?.condition && phase.condition !== "{}"
      ? { condition: phase.condition }
      : {}),
    ...(phase?.savedGroups?.length ? { savedGroups: phase.savedGroups } : {}),
    ...(phase?.prerequisites?.length
      ? { prerequisites: phase.prerequisites }
      : {}),
  };
  // The payload applies the phase's coverage to the released value too,
  // hashed the same way, so the same users keep it.
  return coverage < 1
    ? {
        ...kept,
        type: "rollout",
        coverage,
        hashAttribute: experiment.hashAttribute,
        ...(experiment.fallbackAttribute && !experiment.disableStickyBucketing
          ? { fallbackAttribute: experiment.fallbackAttribute }
          : {}),
        // The SDK seeds a seedless rollout with the flag key.
        seed: phase?.seed || featureId,
        ...(experiment.hashVersion
          ? { hashVersion: experiment.hashVersion }
          : {}),
      }
    : { ...kept, type: "force" };
}

// Freezes the temporary rollout into a permanent rule.
export async function materializeExperimentRules({
  context,
  experiment,
  features,
  eventAudit,
  audit,
  restApiBypassesReviews,
}: CleanupArgs): Promise<void> {
  if (!experiment.releasedVariationId) {
    throw new Error("The experiment has no released variation to keep.");
  }
  if (experiment.phases[experiment.phases.length - 1]?.namespace?.enabled) {
    throw new Error(
      "A namespaced experiment cannot be kept as a permanent rule; stop the temporary rollout instead.",
    );
  }

  await resolveRulesForExperiment({
    context,
    experiment,
    features,
    eventAudit,
    audit,
    restApiBypassesReviews,
    action: "replace experiment rule with a permanent rule",
    comment: `Keep the released variation of "${experiment.name}"`,
    replacement: (rule, featureId) =>
      keptExperimentRule(experiment, rule, featureId),
  });
}
