import { cloneDeep, isEqual, omit } from "lodash";
import { v4 as uuidv4 } from "uuid";
import type {
  ExperimentSnapshotSettings,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import type { ContextualBanditSnapshot } from "shared/types/stats";
import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type {
  ContextualBanditRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ContextualBanditEventInterface,
  ContextualBanditInterface,
  ContextualBanditQueryInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
  getEffectiveContextualAttributes,
  LeafWeight,
  RevisionRampAction,
} from "shared/validators";
import type { SDKAttributeSchema } from "shared/types/organization";
import {
  autoMerge,
  reconcileMergeBaselines,
  isManagedFeature,
} from "shared/util";
import { conditionFromLeafClauses } from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { discardIfJustCreated } from "back-end/src/api/features/validations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { publishRevision } from "back-end/src/models/FeatureModel";
import {
  getLinkageSyncRevisionSummaries,
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { syncFeatureContextualBanditLinkages } from "back-end/src/util/featureContextualBanditSync";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { assertConfigBackedFeatureValuesValid } from "back-end/src/services/configValidation";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import {
  assertCanAutoPublish,
  generateRuleId,
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { computeContextualBanditStageAndSchedule } from "back-end/src/services/contextualBanditSchedule";
import { stampRuleForEnvs } from "back-end/src/util/revisionRuleOps";
import { BadRequestError, ManagedFeatureError } from "back-end/src/util/errors";
import {
  ContextualBanditResultsQueryRunner,
  ContextualBanditSrmResult,
} from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";
import {
  ContextualBanditResult,
  ContextualBanditStatsSettings,
} from "./contextualBanditStats";

/**
 * Every contextual bandit snapshot only considers the trailing 90 days of data
 * so weight updates reflect recent behavior rather than the full lifetime.
 */
const CONTEXTUAL_BANDIT_LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enriched info for the features that link to this Contextual Bandit (via
 * `contextual-bandit-ref` rules). Mirrors `getLinkedFeatureInfo` for experiments
 * so the CB detail page can reuse the same `LinkedFeatureInfo` UI shape.
 */
export async function getContextualBanditLinkedFeatureInfo(
  context: ReqContext | ApiReqContext,
  contextualBandit: ContextualBanditInterface,
) {
  // `linkedFeatures` is live-only, so a feature whose rule still sits in an
  // unpublished draft would be missing from the list the UI renders and the
  // start flow gates on. Pending drafts cover exactly that case.
  const linkedFeatureIds = Array.from(
    new Set([
      ...(contextualBandit.linkedFeatures ?? []),
      ...(contextualBandit.pendingFeatureDrafts ?? []).map((d) => d.featureId),
    ]),
  );

  return getRefLinkedFeatureInfo({
    context,
    linkedFeatureIds,
    refIsDraft: contextualBandit.status === "draft",
    matchRule: (rule) =>
      rule.type === "contextual-bandit-ref" &&
      rule.contextualBanditId === contextualBandit.id,
    pendingFeatureDrafts: contextualBandit.pendingFeatureDrafts,
  });
}

type ContextualBanditFeatureLinkOptions = {
  context: ReqContext | ApiReqContext;
  contextualBandit: ContextualBanditInterface;
  eventAudit: EventUser;
  audit: (input: AuditInterfaceInput) => Promise<void>;
  /** Publish the resulting revision immediately instead of leaving it as a draft. */
  autoPublish?: boolean;
  /** Bundle the change into this existing draft instead of starting a new one. */
  draftVersion?: number;
};

const isRuleForContextualBandit = (
  rule: FeatureRule,
  contextualBanditId: string,
) =>
  rule.type === "contextual-bandit-ref" &&
  rule.contextualBanditId === contextualBanditId;

/** Revision a link edit lands on: an explicitly targeted open draft, otherwise a new draft branched off live. */
function resolveLinkTargetVersion(
  feature: FeatureInterface,
  {
    autoPublish,
    draftVersion,
    forceNewDraft,
  }: { autoPublish?: boolean; draftVersion?: number; forceNewDraft?: boolean },
): number {
  return autoPublish || forceNewDraft
    ? feature.version
    : (draftVersion ?? feature.version);
}

/** Rules the edit gets applied on top of: the targeted draft's own rules, or live when a new draft will be branched off it. */
async function getRulesForTargetVersion(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  targetVersion: number,
): Promise<FeatureRule[]> {
  if (targetVersion === feature.version) {
    return feature.rules ?? [];
  }
  const existingDraft = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: targetVersion,
  });
  if (!existingDraft) {
    throw new Error("Cannot find revision");
  }
  return existingDraft.rules ?? [];
}

/**
 * Whether the revision a new link would land on already carries a rule for this
 * bandit.
 */
export async function targetRevisionHasContextualBanditRule({
  context,
  contextualBandit,
  feature,
  autoPublish,
  draftVersion,
  forceNewDraft,
}: {
  context: ReqContext | ApiReqContext;
  contextualBandit: ContextualBanditInterface;
  feature: FeatureInterface;
  autoPublish?: boolean;
  draftVersion?: number;
  forceNewDraft?: boolean;
}): Promise<boolean> {
  const rules = await getRulesForTargetVersion(
    context,
    feature,
    resolveLinkTargetVersion(feature, {
      autoPublish,
      draftVersion,
      forceNewDraft,
    }),
  );
  return rules.some((r) => isRuleForContextualBandit(r, contextualBandit.id));
}

/** Merge the draft against live and publish it, mirroring the feature page's publish flow. */
async function publishContextualBanditRevision({
  context,
  feature,
  revision,
  comment,
  audit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  comment: string;
  audit: (input: AuditInterfaceInput) => Promise<void>;
}): Promise<void> {
  await assertCanAutoPublish(context, feature, revision);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
  const { live: mergeLive, base: mergeBase } = reconcileMergeBaselines(
    feature,
    live,
    base,
  );
  const mergeResult = autoMerge(
    mergeLive,
    mergeBase,
    revision,
    context.environments,
    {},
  );
  if (!mergeResult.success) {
    throw new Error(
      `Unable to auto-publish: please resolve conflicts on draft #${revision.version} before publishing.`,
    );
  }

  const updatedFeature = await publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    bypassLockdown: context.permissions.canBypassFlagApprovalChecks(
      feature,
      "feature",
    ),
  });

  await audit({
    event: "feature.publish",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment,
    }),
  });
}

/**
 * Add a `contextual-bandit-ref` rule to the bottom of a feature's rule list and
 * link the feature to the bandit. Lands in a draft unless `autoPublish` is set;
 * an unpublished draft is queued so it auto-publishes when the bandit starts.
 */
export async function linkFeatureToContextualBandit({
  context,
  contextualBandit,
  feature,
  rule,
  eventAudit,
  audit,
  autoPublish,
  draftVersion,
  forceNewDraft,
}: ContextualBanditFeatureLinkOptions & {
  feature: FeatureInterface;
  rule: ContextualBanditRefRule;
  /** Start a new draft off live rather than reusing an open one. */
  forceNewDraft?: boolean;
}): Promise<{ version: number; published: boolean; ruleId: string }> {
  const { environments } = context;

  if (
    rule.type !== "contextual-bandit-ref" ||
    !rule.contextualBanditId ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid contextual bandit rule");
  }

  // Guarded here rather than on the route: the REST routes address the feature
  // as :featureId, which the route-level managed guard (keyed on :id) cannot
  // see. A bandit must not append rules to a flag an experiment owns.
  if (isManagedFeature(feature)) {
    throw new ManagedFeatureError({
      featureId: feature.id,
      experimentId:
        feature.managedBy?.type === "experiment"
          ? feature.managedBy.experimentId
          : "",
    });
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }

  if (
    // Authoring a rule into a draft is draft-class; the publish footprint is
    // checked separately below when the call also lands.
    !context.permissions.canEditFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  let scopedRule: FeatureRule;
  if (rule.allEnvironments === true) {
    scopedRule = {
      ...omit(rule, ["environments"]),
      id: generateRuleId(),
      allEnvironments: true,
    } as FeatureRule;
  } else if (
    rule.allEnvironments === false &&
    Array.isArray(rule.environments)
  ) {
    scopedRule = { ...rule, id: generateRuleId() } as FeatureRule;
  } else {
    scopedRule = stampRuleForEnvs(
      { ...rule, id: generateRuleId() } as FeatureRule,
      environments,
    );
  }

  const ruleEnvFootprint = scopedRule.allEnvironments
    ? environments
    : (scopedRule.environments ?? []);

  // Landing authority only when this call lands. Staging the rule into a draft
  // is authoring, gated above; the draft reaches no one until it is published.
  if (
    autoPublish &&
    !context.permissions.canPublishFeature(feature, ruleEnvFootprint)
  ) {
    context.permissions.throwPermissionError();
  }

  // Contextual-bandit-served values must satisfy the backing Config's schema +
  // invariants, the same as a REST publish. No-op unless the feature is
  // config-backed JSON.
  await assertConfigBackedFeatureValuesValid(context, feature, {
    rules: [scopedRule],
  });

  const targetVersion = resolveLinkTargetVersion(feature, {
    autoPublish,
    draftVersion,
    forceNewDraft,
  });
  // `getDraftRevision` creates a brand-new draft exactly when the target is
  // live — track that so a downstream failure (most commonly an autoPublish
  // rejection) can discard the draft this call opened, rather than leaving an
  // orphaned draft behind for someone else to find.
  const created = targetVersion === feature.version;
  const revision = await getDraftRevision(context, feature, targetVersion);

  try {
    const baseEnvEnabled: Record<string, boolean> = {
      ...Object.fromEntries(
        environments.map((e) => [
          e,
          feature.environmentSettings?.[e]?.enabled ?? false,
        ]),
      ),
      ...(revision.environmentsEnabled ?? {}),
    };
    const envToggles: Record<string, boolean> = {};
    for (const envId of ruleEnvFootprint) {
      if (!environments.includes(envId)) continue;
      if (!baseEnvEnabled[envId]) envToggles[envId] = true;
    }

    const existingRules = cloneDeep(revision.rules ?? []);
    const nextRules = [...existingRules, scopedRule];

    const combinedChanges: Partial<FeatureRevisionInterface> = {
      rules: nextRules,
    };
    if (Object.keys(envToggles).length > 0) {
      combinedChanges.environmentsEnabled = {
        ...(revision.environmentsEnabled ?? {}),
        ...envToggles,
      };
    }
    const bundlingIntoExistingDraft =
      !!draftVersion && !forceNewDraft && !autoPublish;
    if (!bundlingIntoExistingDraft && !revision.title) {
      combinedChanges.title = "Publish contextual bandit";
    }

    const auditSubject = scopedRule.allEnvironments
      ? "to all environments"
      : `to ${ruleEnvFootprint.join(", ") || "no environments"}`;
    const updatedRevision = await updateRevision(
      context,
      feature,
      revision,
      combinedChanges,
      {
        user: eventAudit,
        action: "add contextual bandit rule",
        subject: auditSubject,
        value: JSON.stringify(scopedRule),
      },
    );
    await recordRevisionUpdate(context, feature, updatedRevision, "rule.add", {
      environments: ruleEnvFootprint,
    });

    // Linkage is not written here: the revision write reconciles the queued draft
    // off the new rules, and publishing reconciles `linkedFeatures` off what went
    // live. Both derive the same answer this could only restate.
    let published = false;
    if (autoPublish) {
      await publishContextualBanditRevision({
        context,
        feature,
        revision: updatedRevision,
        comment: `Add contextual bandit rule for "${contextualBandit.name}"`,
        audit,
      });
      published = true;
    }

    return {
      version: updatedRevision.version,
      published,
      ruleId: scopedRule.id,
    };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

/**
 * Replace every `contextual-bandit-ref` rule for this bandit on the feature,
 * preserving each rule's id and position. The whole rule is replaced, so the
 * caller has to send a complete definition rather than a patch.
 */
export async function updateContextualBanditFeatureRule({
  context,
  contextualBandit,
  feature,
  rule,
  eventAudit,
  audit,
  autoPublish,
  draftVersion,
}: ContextualBanditFeatureLinkOptions & {
  feature: FeatureInterface;
  rule: ContextualBanditRefRule;
}): Promise<{ version: number; published: boolean; ruleIds: string[] }> {
  const { environments } = context;

  if (
    rule.type !== "contextual-bandit-ref" ||
    !rule.contextualBanditId ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid contextual bandit rule");
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }

  if (
    // Authoring a rule into a draft is draft-class; the publish footprint is
    // checked separately below when the call also lands.
    !context.permissions.canEditFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const isRuleForBandit = (r: FeatureRule) =>
    isRuleForContextualBandit(r, contextualBandit.id);

  // Read the target revision before `getDraftRevision`, which would otherwise
  // branch a draft off live that we may end up rejecting.
  const targetVersion = draftVersion ?? feature.version;
  const noRuleMessage = `Feature Flag ${feature.id} has no rule for this contextual bandit on revision ${targetVersion}.`;
  const baseRules = await getRulesForTargetVersion(
    context,
    feature,
    targetVersion,
  );
  const [baselineRule, ...siblingRules] = baseRules.filter(isRuleForBandit);
  if (!baselineRule) {
    throw new BadRequestError(noRuleMessage);
  }
  // One replacement can't faithfully stand in for definitions that have drifted
  // apart, so refuse rather than silently collapsing them into each other.
  const baseline = omit(baselineRule, ["id"]);
  if (siblingRules.some((r) => !isEqual(omit(r, ["id"]), baseline))) {
    // Note: this is unlikely to happen but we should guard against it anyways
    throw new BadRequestError(
      `Feature Flag ${feature.id} has multiple rules for this contextual bandit and they are not identical. Edit them individually on revision ${targetVersion} instead.`,
    );
  }

  let scopedRule: FeatureRule;
  if (rule.allEnvironments === true) {
    scopedRule = {
      ...omit(rule, ["environments"]),
      allEnvironments: true,
    } as FeatureRule;
  } else if (
    rule.allEnvironments === false &&
    Array.isArray(rule.environments)
  ) {
    scopedRule = { ...rule } as FeatureRule;
  } else {
    scopedRule = stampRuleForEnvs({ ...rule } as FeatureRule, environments);
  }

  const envsForRule = (r: FeatureRule) =>
    r.allEnvironments || r.environments === undefined
      ? environments
      : (r.environments ?? []);
  // Shrinking the scope changes the environments the rule is leaving too.
  const ruleChangedEnvs = Array.from(
    new Set([
      ...envsForRule(baselineRule),
      ...siblingRules.flatMap(envsForRule),
      ...envsForRule(scopedRule),
    ]),
  );

  // Landing authority only when this call lands, as above.
  if (
    autoPublish &&
    !context.permissions.canPublishFeature(feature, ruleChangedEnvs)
  ) {
    context.permissions.throwPermissionError();
  }

  await assertConfigBackedFeatureValuesValid(context, feature, {
    rules: [scopedRule],
  });

  // Same discard-on-failure guard as `linkFeatureToContextualBandit`:
  // `getDraftRevision` only creates a new draft when targeting live, so only
  // that case leaves an orphaned draft behind for a downstream failure (most
  // commonly an autoPublish rejection) to clean up.
  const created = targetVersion === feature.version;
  const revision = await getDraftRevision(context, feature, targetVersion);

  try {
    const ruleIds: string[] = [];
    const nextRules = cloneDeep(revision.rules ?? []).map((r) => {
      if (!isRuleForBandit(r)) return r;
      ruleIds.push(r.id);
      return { ...scopedRule, id: r.id } as FeatureRule;
    });
    if (!ruleIds.length) {
      throw new BadRequestError(noRuleMessage);
    }

    const updatedRevision = await updateRevision(
      context,
      feature,
      revision,
      { rules: nextRules },
      {
        user: eventAudit,
        action: "update contextual bandit rule",
        subject: `rule ${ruleIds.join(", ")}`,
        value: JSON.stringify(scopedRule),
      },
    );
    await recordRevisionUpdate(
      context,
      feature,
      updatedRevision,
      "rule.update",
      {
        environments: ruleChangedEnvs,
      },
    );

    let published = false;
    if (autoPublish) {
      await publishContextualBanditRevision({
        context,
        feature,
        revision: updatedRevision,
        comment: `Update contextual bandit rule for "${contextualBandit.name}"`,
        audit,
      });
      published = true;
    }

    return { version: updatedRevision.version, published, ruleIds };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

// Mirror image of `linkFeatureToContextualBandit`: strip every
// `contextual-bandit-ref` rule pointing at this bandit off the feature. The
// linkage only comes off once the removal is live — until then the live revision
// is still serving the rule, so the feature is still linked to the bandit.
export async function unlinkFeatureFromContextualBandit({
  context,
  contextualBandit,
  featureId,
  feature,
  eventAudit,
  audit,
  autoPublish,
  draftVersion,
}: ContextualBanditFeatureLinkOptions & {
  featureId: string;
  feature: FeatureInterface;
}): Promise<{
  removedRuleIds: string[];
  revisionVersion: number | null;
  published: boolean;
}> {
  const { environments } = context;

  const isRuleForBandit = (r: FeatureRule) =>
    isRuleForContextualBandit(r, contextualBandit.id);

  if (
    // Authoring a rule into a draft is draft-class; the publish footprint is
    // checked separately below when the call also lands.
    !context.permissions.canEditFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  // Check the rules we'd be editing before touching anything — `getDraftRevision`
  // creates a draft off live, and there's nothing to stage when the rule is
  // already gone (a discarded draft, say).
  const targetVersion = draftVersion ?? feature.version;
  const baseRules = await getRulesForTargetVersion(
    context,
    feature,
    targetVersion,
  );
  if (!baseRules.some(isRuleForBandit)) {
    // Nothing to remove on the revision we were pointed at, so there is no
    // revision write to reconcile off. Reconcile directly instead, in case the
    // bandit is holding linkage the rules no longer justify.
    const { openDrafts, liveRevision } = await getLinkageSyncRevisionSummaries(
      feature.organization,
      featureId,
    );
    await syncFeatureContextualBanditLinkages(
      context,
      featureId,
      openDrafts,
      liveRevision,
    );
    return { removedRuleIds: [], revisionVersion: null, published: false };
  }

  // Same discard-on-failure guard as `linkFeatureToContextualBandit`:
  // `getDraftRevision` only creates a new draft when targeting live, so only
  // that case leaves an orphaned draft behind for a downstream failure (most
  // commonly an autoPublish rejection) to clean up.
  const created = targetVersion === feature.version;
  const revision = await getDraftRevision(context, feature, targetVersion);

  try {
    const existingRules = cloneDeep(revision.rules ?? []);
    const removedRules = existingRules.filter(isRuleForBandit);
    const nextRules = existingRules.filter((r) => !isRuleForBandit(r));
    const removedRuleIds = removedRules.map((r) => r.id);

    const ruleChangedEnvs = Array.from(
      new Set(
        removedRules.flatMap((r) =>
          r.allEnvironments || r.environments === undefined
            ? environments
            : (r.environments ?? []),
        ),
      ),
    );

    // Landing authority only when this call lands, as above.
    if (
      autoPublish &&
      !context.permissions.canPublishFeature(feature, ruleChangedEnvs)
    ) {
      context.permissions.throwPermissionError();
    }

    // Strip any pending ramp actions for the removed rules so publish doesn't
    // create a schedule doc that would immediately be cleaned up as orphaned.
    const changes: {
      rules: FeatureRule[];
      rampActions?: RevisionRampAction[];
    } = { rules: nextRules };
    const existingRampActions = revision.rampActions ?? [];
    const filteredRampActions = existingRampActions.filter(
      (a) => !removedRuleIds.includes(a.ruleId),
    );
    if (filteredRampActions.length !== existingRampActions.length) {
      changes.rampActions = filteredRampActions;
    }

    const updatedRevision = await updateRevision(
      context,
      feature,
      revision,
      changes,
      {
        user: eventAudit,
        action: "delete contextual bandit rule",
        subject: `rule ${removedRuleIds.join(", ")}`,
        value: JSON.stringify(removedRules),
      },
    );
    await recordRevisionUpdate(
      context,
      feature,
      updatedRevision,
      "rule.delete",
      {
        environments: ruleChangedEnvs,
      },
    );

    // As with linking, the linkage follows from the rules: the revision write
    // retires the queued draft, and publishing is what takes the feature out of
    // `linkedFeatures`, once the removal is actually live.
    let published = false;
    if (autoPublish) {
      await publishContextualBanditRevision({
        context,
        feature,
        revision: updatedRevision,
        comment: `Remove contextual bandit rule for "${contextualBandit.name}"`,
        audit,
      });
      published = true;
    }

    return {
      removedRuleIds,
      revisionVersion: updatedRevision.version,
      published,
    };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export type ContextualBanditResultsForUi = {
  contextualBanditSnapshot: ContextualBanditSnapshot | null;
  latestSnapshotSummary: SnapshotStatusSummary | null;
  /** SRM of the latest snapshot run; null when the run has no SRM result. */
  srm: ContextualBanditSrmResult | null;
};

function mapCbsStatusToSnapshotStatus(
  status: ContextualBanditSnapshotInterface["status"],
): SnapshotStatusSummary["status"] {
  if (status === "success" || status === "partial") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  return "running";
}

export function toContextualBanditSnapshotStatusSummary(
  cbs: ContextualBanditSnapshotInterface,
): SnapshotStatusSummary {
  return {
    id: cbs.id,
    status: mapCbsStatusToSnapshotStatus(cbs.status),
    error: cbs.error ?? "",
    queries: cbs.queries,
    runStarted: cbs.runStarted,
    dateCreated: cbs.dateCreated,
    multipleExposures: 0,
    type: "standard",
    triggeredBy: cbs.triggeredBy,
  };
}

/** Latest CBS run status + CBE stats payload for the CB results UI. */
export async function getContextualBanditResultsForUi(
  context: ReqContext,
  cb: ContextualBanditInterface,
): Promise<ContextualBanditResultsForUi> {
  const [latestSnapshot, latestEvent] = await Promise.all([
    context.models.contextualBanditSnapshots.getLatestForContextualBandit(
      cb.id,
    ),
    context.models.contextualBanditEvents.getLatestForContextualBandit(cb.id),
  ]);

  const contextualBanditSnapshot: ContextualBanditSnapshot | null = latestEvent
    ? {
        attributes: latestEvent.attributes,
        responses: latestEvent.responses,
        leaf_map: latestEvent.leaf_map,
        leaf_stats: latestEvent.leaf_stats,
        sse_trajectory: latestEvent.sse_trajectory,
        bic_trajectory: latestEvent.bic_trajectory,
      }
    : null;

  const latestSnapshotSummary = latestSnapshot
    ? toContextualBanditSnapshotStatusSummary(latestSnapshot)
    : null;

  return {
    contextualBanditSnapshot,
    latestSnapshotSummary,
    srm: latestSnapshot?.srm ?? null,
  };
}

export async function runContextualBanditSnapshot(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  opts: {
    triggeredBy: "manual" | "scheduled";
    wait?: boolean;
  },
): Promise<{ snapshotId: string; cbeId?: string }> {
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const ds = await getDataSourceById(context, cb.datasource);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasource}`);

  const cbQuery = await context.models.contextualBanditQueries.getById(
    cb.contextualBanditQueryId,
  );
  if (!cbQuery) {
    throw new Error(
      `Contextual bandit query missing: ${cb.contextualBanditQueryId}`,
    );
  }

  // Compute bandit stage before running the update, in case this
  // update moves bandits from explore to exploit.
  const scheduleChanges = computeContextualBanditStageAndSchedule(cb);
  const updatedCb = await context.models.contextualBandits.update(
    cb,
    scheduleChanges,
  );

  const snapshotSettings = buildContextualBanditSnapshotSettings(
    updatedCb,
    cbQuery,
    context.org.settings?.attributeSchema,
  );

  const droppedContextualAttributes = updatedCb.contextualAttributes.filter(
    (a) => !snapshotSettings.contextualAttributes.includes(a),
  );
  if (droppedContextualAttributes.length > 0) {
    const previousSnapshot =
      await context.models.contextualBanditSnapshots.getLatestForContextualBandit(
        updatedCb.id,
      );
    if (
      !isEqual(
        previousSnapshot?.frozenSettings?.contextualAttributes,
        snapshotSettings.contextualAttributes,
      )
    ) {
      try {
        await context.auditLog({
          event: "contextualBandit.update",
          entity: {
            object: "contextualBandit",
            id: updatedCb.id,
          },
          details: auditDetailsUpdate(
            { contextualAttributes: updatedCb.contextualAttributes },
            { contextualAttributes: snapshotSettings.contextualAttributes },
            { droppedContextualAttributes, triggeredBy: opts.triggeredBy },
          ),
        });
      } catch (e) {
        context.logger.error(
          e,
          `Error creating audit log for dropped contextual attributes (${updatedCb.id})`,
        );
      }
    }
  }

  const cbs = await context.models.contextualBanditSnapshots.create({
    contextualBandit: updatedCb.id,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: snapshotSettings,
    triggeredBy: opts.triggeredBy === "manual" ? "manual" : "schedule",
    weightsWereUpdated: false,
  });

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new ContextualBanditResultsQueryRunner(
    context,
    cbs,
    integration,
    false,
  );

  const variationNames = (updatedCb.variations ?? []).map((v) => v.name);

  await runner.startAnalysis({
    snapshotSettings,
    variationNames,
  });

  if (!opts.wait) {
    return { snapshotId: cbs.id };
  }

  await runner.waitForResults();

  const finalCbs =
    await context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(cbs.id);
  if (!finalCbs) {
    throw new Error(`CBS disappeared during run: ${cbs.id}`);
  }
  if (finalCbs.status === "error") {
    throw new Error(
      finalCbs.error ??
        "Contextual bandit snapshot failed with no error message",
    );
  }

  return {
    snapshotId: finalCbs.id,
    cbeId: finalCbs.contextualBanditEventId ?? undefined,
  };
}

export async function cancelContextualBanditLatestRunningSnapshot(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<void> {
  const latest =
    await context.models.contextualBanditSnapshots.getLatestForContextualBandit(
      cb.id,
    );
  if (!latest || latest.status !== "running") return;

  const ds = await getDataSourceById(context, cb.datasource);
  if (!ds) throw new Error(`Datasource missing: ${cb.datasource}`);

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new ContextualBanditResultsQueryRunner(
    context,
    latest,
    integration,
    false,
  );
  await runner.cancelQueries();
  await context.models.contextualBanditSnapshots.delete(latest);
}

/**
 * Collapses a run's per-leaf `leaf_map` into one `LeafWeight` per tree leaf:
 * `{ leafId, condition, weights }`. `condition` is the targeting predicate that
 * routes a context to the leaf (derived from the leaf's structured clauses), so
 * the persisted weights are self-contained for the SDK payload without re-joining
 * the event's `leaf_map`. Leaves whose responses carry no updated weights are
 * skipped.
 */
export function leafWeightsFromContextualBanditResult(
  result: ContextualBanditResult,
  variations: { id: string }[],
): LeafWeight[] {
  const responses = result.responses ?? [];
  const leafMap = result.leaf_map ?? [];

  const updatedWeightsByLeaf = new Map<number, number[]>();
  responses.forEach((response) => {
    const leafId = response.leafId ?? 0;
    const updatedWeights = response.updatedWeights;
    if (updatedWeights && updatedWeights.length > 0) {
      if (!updatedWeightsByLeaf.has(leafId)) {
        updatedWeightsByLeaf.set(leafId, updatedWeights);
      }
    }
  });

  const leafWeights: LeafWeight[] = [];
  for (const entry of [...leafMap].sort((a, b) => a.leafId - b.leafId)) {
    const updatedWeights = updatedWeightsByLeaf.get(entry.leafId);
    if (!updatedWeights || updatedWeights.length === 0) {
      continue;
    }
    leafWeights.push({
      leafId: entry.leafId,
      condition: conditionFromLeafClauses(entry.context),
      weights: updatedWeights.map((weight, i) => ({
        variationId: variations[i]?.id ?? String(i),
        weight,
      })),
    });
  }
  return leafWeights;
}

export function contextualBanditWeightsWereUpdated(
  result: ContextualBanditResult,
  currentLeafWeights: LeafWeight[],
  variations: { id: string }[],
): boolean {
  const newLeafWeights = leafWeightsFromContextualBanditResult(
    result,
    variations,
  );

  if (newLeafWeights.length === 0) {
    return false;
  }

  if (newLeafWeights.length !== currentLeafWeights.length) {
    return true;
  }

  const currentByCondition = new Map(
    currentLeafWeights.map((lw) => [
      JSON.stringify(lw.condition),
      { leafId: lw.leafId, weights: lw.weights.map((p) => p.weight) },
    ]),
  );

  return newLeafWeights.some((lw) => {
    const current = currentByCondition.get(JSON.stringify(lw.condition));
    if (!current) {
      return true;
    }
    return (
      current.leafId !== lw.leafId ||
      JSON.stringify(current.weights) !==
        JSON.stringify(lw.weights.map((p) => p.weight))
    );
  });
}

/** Persists one CB run's side effects: creates the CBE doc, patches parent CB leaf weights, refreshes SDK payload. */
export async function persistContextualBanditEvent(
  context: ReqContext,
  cbs: ContextualBanditSnapshotInterface,
  result: ContextualBanditResult & { srm?: ContextualBanditSrmResult },
): Promise<ContextualBanditEventInterface> {
  const cb = await context.models.contextualBandits.getById(
    cbs.contextualBandit,
  );
  if (!cb) {
    throw new Error(`No CB doc for ${cbs.contextualBandit}`);
  }

  const currentLeafWeights = cb.currentLeafWeights ?? [];
  const inExploreStage = cb.stage === "explore";
  const weightsWereUpdated = inExploreStage
    ? false
    : contextualBanditWeightsWereUpdated(
        result,
        currentLeafWeights,
        cb.variations,
      );
  const leafWeights = inExploreStage
    ? []
    : leafWeightsFromContextualBanditResult(result, cb.variations);

  // Generate a new random seed when weights are updated to re-bucket users each period
  const newSeed = weightsWereUpdated ? uuidv4() : undefined;

  const cbe = await context.models.contextualBanditEvents.create({
    contextualBandit: cb.id,
    snapshotId: cbs.id,
    attributes: result.attributes,
    responses: result.responses,
    leaf_map: result.leaf_map,
    leaf_stats: result.leaf_stats,
    sse_trajectory: result.sse_trajectory,
    bic_trajectory: result.bic_trajectory,
    weightsWereUpdated,
    ...(result.srm ? { degreesOfFreedom: result.srm.degreesOfFreedom } : {}),
    // Store the seed for historical tracking
    ...(newSeed ? { seed: newSeed } : {}),
  });

  const updatedCb = await context.models.contextualBandits.patchLeafWeights(
    cb.id,
    leafWeights,
    {
      bumpVersion: weightsWereUpdated,
      newSeed,
    },
  );

  if (weightsWereUpdated) {
    await refreshLinkedFeaturePayloads(
      context,
      updatedCb,
      "contextualBandit.refresh",
    );
    // Best-effort: a throw here would leave the snapshot running and re-persist.
    try {
      await context.auditLog({
        event: "contextualBandit.update",
        entity: {
          object: "contextualBandit",
          id: cb.id,
        },
        details: auditDetailsUpdate(cb, updatedCb),
      });
    } catch (e) {
      context.logger.error(
        e,
        `Error creating audit log for contextualBandit.update (${cb.id})`,
      );
    }
  }

  return cbe;
}

/** Builds the frozen snapshot settings stored on CBS so the run is reproducible if the parent CB mutates. */
export function buildContextualBanditSnapshotSettings(
  cb: ContextualBanditInterface,
  cbQuery: ContextualBanditQueryInterface,
  attributeSchema: SDKAttributeSchema | undefined,
): ContextualBanditSnapshotSettings {
  const numVariations = cb.variations?.length || 1;

  const effectiveContextualAttributes = getEffectiveContextualAttributes(
    cb.contextualAttributes,
    cbQuery.targetingAttributeColumns,
    attributeSchema,
  );
  if (effectiveContextualAttributes.length === 0) {
    throw new Error(
      `Contextual bandit ${cb.id} has no usable contextual attributes: none of its selected attributes are on both the query and the attribute schema.`,
    );
  }

  const banditStart = cb.dateStarted ?? new Date();
  const effectiveEnd = cb.dateStopped ?? new Date();
  const lookbackStart = new Date(
    effectiveEnd.getTime() - CONTEXTUAL_BANDIT_LOOKBACK_DAYS * DAY_MS,
  );
  const startDate = new Date(
    Math.max(banditStart.getTime(), lookbackStart.getTime()),
  );

  return {
    experimentId: cb.id,
    trackingKey: cb.trackingKey || cb.id,
    contextualBanditId: cb.id,

    datasourceId: cb.datasource,
    contextualBanditQueryId: cb.contextualBanditQueryId,
    query: cbQuery.query,
    userIdType: cbQuery.userIdType,
    contextualAttributes: effectiveContextualAttributes,

    decisionMetric: cb.decisionMetric ?? "",
    metricSettings: {},

    variations: (cb.variations ?? []).map((v) => ({
      id: v.id,
      weight:
        cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
        1 / numVariations,
    })),

    minUsersPerLeaf: cb.minUsersPerLeaf,
    maxLeaves: cb.maxLeaves,
    banditModelVersion: cb.banditModelVersion,

    startDate,
    endDate: cb.dateStopped ?? null,
    reweight: true,
    banditWeightsSeed: 0,

    // TODO(holdout-v1.5): thread `holdoutPercent` + seed so SQL can split train_id=0/1 and stats can compute holdout-vs-bandit lift.
  };
}

/** Translates `ContextualBanditSnapshotSettings` into the `ExperimentSnapshotSettings` shape used by `SqlIntegration.getSnapshotMetricQuery`. */
export function buildSnapshotSettingsForCb(
  cbSnapshotSettings: ContextualBanditSnapshotSettings,
): ExperimentSnapshotSettings {
  const decisionMetric = cbSnapshotSettings.decisionMetric;
  return {
    experimentId: cbSnapshotSettings.trackingKey,
    queryFilter: "",
    datasourceId: cbSnapshotSettings.datasourceId,
    exposureQueryId: cbSnapshotSettings.contextualBanditQueryId,
    startDate: cbSnapshotSettings.startDate,
    endDate: cbSnapshotSettings.endDate ?? new Date(),
    goalMetrics: decisionMetric ? [decisionMetric] : [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    metricSettings: [],
    variations: cbSnapshotSettings.variations,
    dimensions: [],
    coverage: cbSnapshotSettings.variations.reduce((s, v) => s + v.weight, 0),
    segment: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    regressionAdjustmentEnabled: false,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    banditSettings: {
      contextualBandit: true,
      targetingAttributeColumns: cbSnapshotSettings.contextualAttributes,
      reweight: cbSnapshotSettings.reweight,
      decisionMetric,
      seed: cbSnapshotSettings.banditWeightsSeed,
      currentWeights: cbSnapshotSettings.variations.map((v) => v.weight),
      historicalWeights: [],
    },
  };
}

export function getContextualBanditSettingsForStatsEngine(
  cb: ContextualBanditInterface,
  variationIds: string[],
  contextualAttributes: string[],
): ContextualBanditStatsSettings {
  return {
    varIds: variationIds,
    contextualAttributes,
    maxLeaves: cb.maxLeaves,
    minUsersPerLeaf: cb.minUsersPerLeaf,
  };
}
