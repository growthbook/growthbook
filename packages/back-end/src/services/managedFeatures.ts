import { RequestHandler } from "express";
import type { z } from "zod";
import {
  copyManagedVariationValues,
  isManagedFeature,
  managedByExperimentId,
  isManagedByExperiment,
  checkIfRevisionNeedsReview,
  managedFeatureKeyCandidate,
  mergeResultHasChanges,
  seedManagedVariationValues,
  validateFeatureValue,
  type ManagedFlagKeyPlan,
  PermissionError,
} from "shared/util";
import {
  ExperimentInterface,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureValueType,
  apiExperimentVariationValues,
  type ImplementationType,
} from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type {
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { AuditInterfaceInput } from "shared/types/audit";
import { bypassApprovalPermission } from "shared/permissions";
import { ApiReqContext } from "back-end/types/api";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { OpenApiRoute, runApiHandler } from "back-end/src/util/handler";
import {
  archiveFeature,
  createFeature,
  deleteFeature,
  featureIdExists,
  getFeature,
  getFeatureProjectsByIds,
  getFeaturesByIds,
  getManagedFlagIdsUnfiltered,
  publishRevision,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getActiveDraft,
  getRevision,
  markRevisionAsReviewRequested,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  experimentIdExists,
  getExperimentById,
  getExperimentByTrackingKey,
  unlinkFeatureFromExperiment,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  BadRequestError,
  FeatureKeyTakenError,
  ManagedFeatureError,
  ManagedFeatureErrorSurface,
  NotFoundError,
  SoftWarningError,
} from "back-end/src/util/errors";
import {
  makeBlockingGate,
  PublishBlockedError,
  type PublishGate,
} from "back-end/src/revisions/publishGates";
import {
  getContextFromReq,
  getEnvironments,
} from "back-end/src/services/organizations";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { logger } from "back-end/src/util/logger";
import {
  assessRevisionApprovalForAutoPublish,
  ExperimentFeatureLinkResult,
  linkFeatureToExperiment,
  mergeDraftForAutoPublish,
  updateExperimentRefVariations,
  validateExperimentFeatureUpdates,
} from "back-end/src/services/experiment-feature";

// Guarded at the request entry points, not the model: the model can't tell a
// user edit from the experiment's own start/stop/holdout/ramp writes.

export function assertLoadedFeatureNotManaged(
  feature: FeatureInterface,
  surface: ManagedFeatureErrorSurface = "app",
): void {
  if (!isManagedFeature(feature)) return;
  throw new ManagedFeatureError({
    featureId: feature.id,
    experimentId: managedByExperimentId(feature) ?? "",
    surface,
  });
}

export async function assertFeatureNotManaged(
  context: ReqContext | ApiReqContext,
  featureId: string,
  surface: ManagedFeatureErrorSurface = "app",
): Promise<void> {
  const feature = await getFeature(context, featureId);
  // Missing or unreadable is the handler's 404 to raise, not ours.
  if (!feature) return;
  assertLoadedFeatureNotManaged(feature, surface);
}

const MAX_KEY_ATTEMPTS = 10;

// Best-effort cleanup of a half-created flag. Swallows its own failure: the
// caller is unwinding a create, and that error is the one worth reporting.
async function discardOrphanedManagedFlag(
  context: ReqContext | ApiReqContext,
  id: string,
): Promise<void> {
  try {
    const orphan = await getFeature(context, id);
    if (orphan) await deleteFeature(context, orphan);
  } catch (err) {
    logger.warn(
      { featureId: id, err },
      "Could not clean up a half-created managed Feature Flag",
    );
  }
}

function isDuplicateKeyError(e: unknown): boolean {
  return (e as { code?: number } | null)?.code === 11000;
}

// Use the return value: `validateFeatureValue` repairs rather than rejects for
// booleans and JSON, so discarding it stores something the SDK reads differently.
function normalizeManagedVariationValues({
  experiment,
  valueType,
  variations,
}: {
  experiment: ExperimentInterface;
  valueType: FeatureValueType;
  variations: ExperimentRefVariation[];
}): ExperimentRefVariation[] {
  if (!variations.length) {
    throw new BadRequestError(
      "A managed Feature Flag requires a value for every variation",
    );
  }

  const expectedIds = experiment.variations.map((v) => v.id);
  const givenIds = new Set(variations.map((v) => v.variationId));
  if (
    givenIds.size !== variations.length ||
    expectedIds.length !== variations.length ||
    expectedIds.some((id) => !givenIds.has(id))
  ) {
    throw new BadRequestError(
      "A managed Feature Flag requires exactly one value per experiment variation",
    );
  }

  return variations.map((v, i) => ({
    ...v,
    value: validateFeatureValue({ valueType }, v.value, `Variation ${i}`),
  }));
}

type CreateManagedFeatureInput = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  valueType: FeatureValueType;
  /** One value per experiment variation, in variation order. */
  variations: ExperimentRefVariation[];
  sparse?: boolean;
  // Exact id instead of one derived from the tracking key. Collisions conflict
  // rather than being suffixed away — this caller has UI to resolve them.
  featureId?: string;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

/** Mirrors the charset `postFeatures` enforces, for ids a user typed. */
const FEATURE_KEY_PATTERN = /^[a-zA-Z0-9_.:|-]+$/;

// Linked ids that no longer resolve. Unfiltered on purpose: a feature the
// caller cannot read still exists and is still linked.
export async function staleLinkedFeatureIds(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<string[]> {
  const ids = experiment.linkedFeatures ?? [];
  const stale: string[] = [];
  for (const id of ids) {
    if (!(await featureIdExists(context, id))) stale.push(id);
  }
  return stale;
}

// Managed mode owns the experiment's whole delivery, so it can only be adopted
// while nothing else is wired up. Counts features that still exist, not ids.
const IMPLEMENTATION_TYPE_NAMES: Partial<Record<ImplementationType, string>> = {
  feature: "a linked Feature Flag",
  urlredirect: "URL Redirects",
  visual: "the Visual Editor",
};

export async function managedFlagAdoptionBlocker(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<string | null> {
  if (experiment.archived) return "This experiment is archived.";
  if (experiment.status !== "draft") {
    return "Only a draft experiment can start managing a Feature Flag.";
  }
  if (experiment.hasVisualChangesets) {
    return "This experiment already has Visual Editor changes.";
  }
  if (experiment.hasURLRedirects) {
    return "This experiment already has URL Redirects.";
  }
  const linkedIds = experiment.linkedFeatures ?? [];
  if (linkedIds.length) {
    const stale = new Set(await staleLinkedFeatureIds(context, experiment));
    if (linkedIds.some((id) => !stale.has(id))) {
      return "This experiment already has a linked Feature Flag.";
    }
  }
  // Nothing is linked, so only an explicit choice of another kind stands.
  const chosen = experiment.implementationType;
  if (
    chosen &&
    chosen !== "values" &&
    chosen !== "none" &&
    chosen !== "multi"
  ) {
    return `This experiment is set up for ${IMPLEMENTATION_TYPE_NAMES[chosen]}. Set implementationType to "values" first.`;
  }
  return null;
}

const MAX_PAIR_SUGGESTIONS = 25;

// Authoritative for the feature id (unique index) but advisory for the tracking
// key, whose uniqueness is not indexed and whose lookup is read-scoped.
export async function planManagedFlagKey({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}): Promise<ManagedFlagKeyPlan> {
  const derivedId = managedFeatureKeyCandidate({
    trackingKey: experiment.trackingKey,
    experimentId: experiment.id,
    attempt: 0,
  });
  const derivedIdAvailable = !(await featureIdExists(context, derivedId));

  const regexValidator = context.org.settings?.featureRegexValidator;
  const regexError =
    regexValidator && !new RegExp(regexValidator).test(derivedId)
      ? `Your organization requires Feature Flag keys to match ${regexValidator}`
      : null;

  let suggestedPair: ManagedFlagKeyPlan["suggestedPair"] = null;
  if (!derivedIdAvailable) {
    for (let attempt = 1; attempt < MAX_PAIR_SUGGESTIONS; attempt++) {
      const candidate = managedFeatureKeyCandidate({
        trackingKey: experiment.trackingKey,
        experimentId: experiment.id,
        attempt,
      });
      if (regexValidator && !new RegExp(regexValidator).test(candidate)) {
        continue;
      }
      if (await featureIdExists(context, candidate)) continue;
      const keyOwner = await getExperimentByTrackingKey(context, candidate);
      if (keyOwner && keyOwner.id !== experiment.id) continue;
      // The candidate is already a sanitized feature key, so using it verbatim
      // as the tracking key makes the pair match exactly.
      suggestedPair = { trackingKey: candidate, featureId: candidate };
      break;
    }
  }

  return {
    derivedId,
    derivedIdAvailable,
    sanitized: derivedId !== experiment.trackingKey,
    suggestedPair,
    regexError,
  };
}

// Creates the flag inert — disabled everywhere, rule and env toggles staged on
// a draft — so nothing serves until the experiment starts and publishes it.
export async function createManagedFeatureForExperiment({
  context,
  experiment,
  valueType,
  variations,
  sparse,
  featureId,
  eventAudit,
  audit,
}: CreateManagedFeatureInput): Promise<{
  feature: FeatureInterface;
  version: number;
}> {
  const { org, userId } = context;

  const values = normalizeManagedVariationValues({
    experiment,
    valueType,
    variations,
  });

  const allEnvironments = getEnvironments(org);
  if (!allEnvironments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }

  const project = experiment.project ?? "";
  if (org.settings?.requireProjectForFeatures && !project) {
    throw new Error(
      "This organization requires a Project on every Feature Flag — set a Project on the experiment first.",
    );
  }

  const regexValidator = org.settings?.featureRegexValidator;

  const baseFeature: Omit<FeatureInterface, "id"> = {
    organization: org.id,
    owner: userId,
    description: experiment.description || "",
    project,
    tags: experiment.tags || [],
    valueType,
    defaultValue: values[0].value,
    // Reaches no payload until the draft publishes, so create authority alone.
    environmentSettings: Object.fromEntries(
      allEnvironments.map((e) => [e.id, { enabled: false }]),
    ),
    rules: [],
    version: 1,
    archived: false,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    holdout: experiment.holdoutId
      ? { id: experiment.holdoutId, value: values[0].value }
      : undefined,
    managedBy: { type: "experiment", experimentId: experiment.id },
  };

  // Create authority alone: the flag is born inert, so nothing here reaches a
  // payload and the seeded values are derived rather than authored.
  if (
    !context.permissions.canCreateFeature(
      baseFeature,
      Array.from(
        getEnabledEnvironments(
          baseFeature as FeatureInterface,
          allEnvironments.map((e) => e.id),
        ),
      ),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (featureId !== undefined && !FEATURE_KEY_PATTERN.test(featureId)) {
    throw new Error(
      "Feature Flag keys can only include letters, numbers, and the characters _-.:|",
    );
  }

  let created: FeatureInterface | null = null;
  let lastCandidate = "";
  const maxAttempts = featureId === undefined ? MAX_KEY_ATTEMPTS : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id =
      featureId ??
      managedFeatureKeyCandidate({
        trackingKey: experiment.trackingKey,
        experimentId: experiment.id,
        attempt,
      });
    lastCandidate = id;

    if (regexValidator && !new RegExp(regexValidator).test(id)) {
      throw new Error(
        featureId === undefined
          ? `The Feature Flag key derived from this experiment ("${id}") does not match your organization's feature key format (${regexValidator}). Rename the experiment tracking key, or turn off managed mode for this experiment.`
          : `Feature Flag key "${id}" does not match your organization's feature key format (${regexValidator}).`,
      );
    }

    try {
      await createFeature(context, { ...baseFeature, id });
      // createFeature writes the document before its initial revision, so a
      // throw past this point leaves a flag marked `managedBy` with no owner.
      created = await getFeature(context, id);
      if (!created) {
        await discardOrphanedManagedFlag(context, id);
        throw new Error(
          `Created Feature Flag "${id}" could not be read back; nothing was kept.`,
        );
      }
      break;
    } catch (e) {
      if (!isDuplicateKeyError(e)) {
        await discardOrphanedManagedFlag(context, id);
        throw e;
      }
      // The index is the arbiter; take the next candidate rather than racing.
      // An explicitly chosen id has a caller who can pick another one.
      if (featureId !== undefined) {
        throw new Error(
          `Feature Flag "${id}" already exists. Choose a different key.`,
        );
      }
    }
  }

  if (!created) {
    throw new Error(
      `Could not find an available Feature Flag key for this experiment (tried up to "${lastCandidate}"). Rename the experiment tracking key and try again.`,
    );
  }

  // A flag with no experiment-ref rule is a locked-down orphan nobody can reach,
  // so undo the create if the link fails.
  let linked: ExperimentFeatureLinkResult;
  try {
    linked = await linkFeatureToExperiment({
      context,
      experiment,
      feature: created,
      rule: {
        type: "experiment-ref",
        description: "",
        id: "",
        allEnvironments: true,
        condition: "",
        enabled: true,
        scheduleRules: [],
        experimentId: experiment.id,
        variations: values,
        ...(sparse ? { sparse: true } : {}),
      },
      eventAudit,
      audit,
      // The experiment's start publishes it; later edits get their own draft.
      autoPublish: false,
      forceNewDraft: true,
    });

    // Inside the compensation boundary: a throw here would otherwise strand a
    // created, linked, permanently locked flag.
    await requestReviewForManagedDraft({
      context,
      feature: created,
      version: linked.version,
      eventAudit,
    });
  } catch (e) {
    // `created` was read before the link landed, so its `linkedExperiments` is
    // empty and `deleteFeature` cannot unlink the experiment side itself.
    await deleteFeature(context, created);
    await unlinkFeatureFromExperiment(context, experiment.id, created.id);
    throw e;
  }

  return { feature: created, version: linked.version };
}

const MAX_SOURCE_READ_ATTEMPTS = 3;

// Null when there is nothing safe to copy; callers seed a fresh flag instead.
async function readManagedValuesForDuplicate({
  context,
  sourceExperiment,
  targetExperiment,
}: {
  context: ReqContext;
  sourceExperiment: ExperimentInterface;
  targetExperiment: ExperimentInterface;
}): Promise<{
  valueType: FeatureValueType;
  variations: ExperimentRefVariation[];
  sparse: boolean;
} | null> {
  for (let attempt = 0; attempt < MAX_SOURCE_READ_ATTEMPTS; attempt++) {
    const before = await getManagedFeatureForExperiment(
      context,
      sourceExperiment,
    );
    if (!before) return null;

    // CAS on the revision, not the feature: only that document is stamped, so
    // feature.dateUpdated cannot see the edit this guard exists to catch.
    const draftBefore = await getActiveDraft(context, before);

    const info = (await getLinkedFeatureInfo(context, sourceExperiment)).find(
      (f) => f.feature.id === before.id,
    );
    if (!info) return null;

    const draftAfter = await getActiveDraft(context, before);
    const stamp = (r: typeof draftBefore) =>
      r ? `${r.version}:${r.dateUpdated.getTime()}` : "none";
    if (stamp(draftBefore) === stamp(draftAfter)) {
      return {
        // Without `sparse` the copy would read patch values as full values.
        sparse: !!info.sparse,
        valueType: before.valueType,
        variations: copyManagedVariationValues({
          sourceValues: info.values,
          sourceVariations: sourceExperiment.variations,
          targetVariations: targetExperiment.variations,
          valueType: before.valueType,
        }),
      };
    }
  }

  logger.warn(
    { sourceExperiment: sourceExperiment.id },
    "Managed flag source kept changing while copying for a duplicate; seeding fresh values instead",
  );
  return null;
}

// A managed draft goes straight into review; there is no separate request step.
// No-op when approvals aren't required, so those land in plain `draft`.
export async function requestReviewForManagedDraft({
  context,
  feature,
  version,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  version: number;
  eventAudit: EventUser;
}): Promise<void> {
  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision || revision.status !== "draft") return;

  const { base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
  const needsReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: base,
    revision,
    orgEnvironments: getEnvironments(context.org),
    settings: context.org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
  if (!needsReview) return;

  await markRevisionAsReviewRequested(context, revision, eventAudit, "");

  const updated = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  await dispatchFeatureRevisionEvent(
    context,
    feature,
    updated ?? revision,
    "revision.reviewRequested",
    { reviewComment: null },
  );
}

// Copies the source's type and values when duplicated from a managed experiment,
// falling back to seeded values rather than failing the create outright.
export async function createManagedFlagForNewExperiment({
  context,
  experiment,
  sourceExperiment,
  eventAudit,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  sourceExperiment: ExperimentInterface | null;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<void> {
  // Only reached when copying the source failed, so its type is unknown.
  const seeded = {
    valueType: "string" as FeatureValueType,
    variations: seedManagedVariationValues(experiment.variations),
    sparse: false,
  };
  const copied = sourceExperiment
    ? await readManagedValuesForDuplicate({
        context,
        sourceExperiment,
        targetExperiment: experiment,
      })
    : null;

  const create = (plan: typeof seeded) =>
    createManagedFeatureForExperiment({
      context,
      experiment,
      valueType: plan.valueType,
      variations: plan.variations,
      sparse: plan.sparse,
      eventAudit,
      audit,
    });

  await create(copied ?? seeded);
  await updateExperiment({
    context,
    experiment,
    changes: { implementationType: "values" },
  });
}

export type ManagedFlagState = z.infer<typeof apiExperimentVariationValues>;
type ManagedPublishBlocker = NonNullable<
  ManagedFlagState["pending"]
>["publishBlockers"][number];
export type ManagedFlagReview = NonNullable<
  ManagedFlagState["pending"]
>["reviews"][number];

// The whole managed-flag picture in one read. Every action returns it, so a
// caller never has to stitch two requests together.
export async function getManagedFlagState(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<ManagedFlagState> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    const blocker = await managedFlagAdoptionBlocker(context, experiment);
    const plan = await planManagedFlagKey({ context, experiment });
    return {
      managed: false,
      featureKey: null,
      valueType: null,
      sparse: null,
      liveValues: [],
      environments: [],
      allEnvironments: false,
      pending: null,
      adoption: {
        blocker,
        derivedKey: plan.derivedId,
        derivedKeyAvailable: plan.derivedIdAvailable,
        suggestedTrackingKey: plan.suggestedPair?.trackingKey ?? null,
        suggestedFeatureKey: plan.suggestedPair?.featureId ?? null,
        keyRegexError: plan.regexError,
      },
    };
  }

  const info = (await getLinkedFeatureInfo(context, experiment)).find(
    (f) => f.feature.id === feature.id,
  );
  const pendingDraft = info?.pendingDraft ?? null;

  let reviews: ManagedFlagReview[] = [];
  let pendingValueType = feature.valueType;
  if (pendingDraft) {
    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: pendingDraft.version,
    });
    pendingValueType = revision?.metadata?.valueType ?? feature.valueType;
    // A verdict carries no body; the reviewer's comment lives in the revision
    // log, which this surface deliberately does not expose.
    reviews = (revision?.reviews ?? []).map((r) => ({
      userId: r.userId,
      status: r.status,
      timestamp: new Date(r.timestamp).toISOString(),
    }));
  }

  const activeEnvs = (states?: Record<string, LinkedFeatureEnvState>) =>
    Object.entries(states ?? {})
      .filter(([, s]) => s === "active")
      .map(([env]) => env);

  const publishBlockers: ManagedPublishBlocker[] = pendingDraft
    ? [
        // A draft experiment publishes its values by starting.
        ...(experiment.status === "draft"
          ? (["experiment-not-started"] as const)
          : []),
        ...(pendingDraft.hasMergeConflict ? (["merge-conflict"] as const) : []),
        ...(pendingDraft.hasUnrelatedDraftChanges
          ? (["unrelated-draft-changes"] as const)
          : []),
        ...(pendingDraft.rebaseRequired ? (["stale-base"] as const) : []),
        ...(managedApprovalSatisfied(pendingDraft)
          ? []
          : (["approval-required"] as const)),
      ]
    : [];

  return {
    managed: true,
    featureKey: feature.id,
    valueType: feature.valueType,
    sparse: info?.liveSparse ?? null,
    liveValues: info?.liveValues ?? [],
    environments: activeEnvs(info?.liveEnvironmentStates),
    allEnvironments: !!info?.liveAllEnvironments,
    adoption: null,
    pending: pendingDraft
      ? {
          version: pendingDraft.version,
          values: pendingDraft.values,
          valueType: pendingValueType,
          sparse: pendingDraft.sparse,
          environments: activeEnvs(pendingDraft.environmentStates),
          allEnvironments: !!pendingDraft.allEnvironments,
          status: pendingValuesStatus(pendingDraft.status),
          approvalRequired: pendingDraft.pendingApproval,
          canPublish: publishBlockers.length === 0,
          publishBlockers,
          canBypassApproval: context.permissions.canBypassFlagApprovalChecks(
            feature,
            "feature",
          ),
          reviews,
        }
      : null,
  };
}

type PendingValuesStatus = NonNullable<ManagedFlagState["pending"]>["status"];
const PENDING_VALUES_STATUSES: readonly PendingValuesStatus[] = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
];
// An active draft is one of these; anything else has no business being pending.
function pendingValuesStatus(status: string): PendingValuesStatus {
  return (PENDING_VALUES_STATUSES as readonly string[]).includes(status)
    ? (status as PendingValuesStatus)
    : "draft";
}

function managedApprovalSatisfied(
  pendingDraft: NonNullable<LinkedFeatureInfo["pendingDraft"]>,
): boolean {
  return (
    !pendingDraft.pendingApproval ||
    (pendingDraft.approval?.satisfied ?? pendingDraft.status === "approved")
  );
}

// Shared by the internal route and the REST surface, so the rename ordering and
// its rollback stay in one place.
export async function adoptManagedFlagForExperiment({
  context,
  experiment: startingExperiment,
  valueType,
  variations,
  sparse,
  featureId,
  trackingKey,
  eventAudit,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  valueType: FeatureValueType;
  variations: ExperimentRefVariation[];
  sparse?: boolean;
  /** Create under this exact key instead of the derived one. */
  featureId?: string;
  /** Rename the experiment to this key first, so the pair matches. */
  trackingKey?: string;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<{ feature: FeatureInterface; version: number }> {
  let experiment = startingExperiment;
  const blocker = await managedFlagAdoptionBlocker(context, experiment);
  if (blocker) throw new BadRequestError(blocker);

  const originalTrackingKey = experiment.trackingKey;

  const existing = await getManagedFeatureForExperiment(context, experiment);
  if (existing) {
    throw new BadRequestError(
      `This experiment already manages Feature Flag "${existing.id}".`,
    );
  }

  // Planned against the key the experiment will have, before anything is written.
  const keyPlan = await planManagedFlagKey({
    context,
    experiment: {
      ...experiment,
      trackingKey: trackingKey ?? experiment.trackingKey,
    },
  });
  if (featureId === undefined && keyPlan.regexError) {
    throw new BadRequestError(keyPlan.regexError);
  }
  if (featureId === undefined && !keyPlan.derivedIdAvailable) {
    const pair = keyPlan.suggestedPair;
    throw new FeatureKeyTakenError(
      `Feature Flag "${keyPlan.derivedId}" already exists, so it cannot be created for this experiment. Pass featureKey to create the flag under a different key, or trackingKey to rename the experiment so the two still match.${
        pair
          ? ` Suggested: "${pair.trackingKey}" is free as both the tracking key and the Feature Flag key.`
          : ""
      }`,
      {
        featureKey: keyPlan.derivedId,
        suggestedTrackingKey: pair?.trackingKey ?? null,
        suggestedFeatureKey: pair?.featureId ?? null,
      },
    );
  }

  // Rename first: the key is derived at creation and a feature cannot be
  // renamed afterwards, so the order is load-bearing.
  if (trackingKey && trackingKey !== experiment.trackingKey) {
    if (context.org.settings?.requireUniqueExperimentTrackingKeys) {
      const keyOwner = await getExperimentByTrackingKey(context, trackingKey);
      if (keyOwner && keyOwner.id !== experiment.id) {
        throw new BadRequestError(
          `An experiment with tracking key "${trackingKey}" already exists. Your organization requires unique experiment tracking keys.`,
        );
      }
    }
    experiment = await updateExperiment({
      context,
      experiment,
      changes: { trackingKey },
    });
  }

  // A flag deleted out of band leaves its id behind; drop it while we write.
  const stale = await staleLinkedFeatureIds(context, experiment);
  for (const staleId of stale) {
    await unlinkFeatureFromExperiment(context, experiment.id, staleId);
  }
  if (stale.length) {
    experiment =
      (await getExperimentById(context, experiment.id)) ?? experiment;
  }

  // The rename is already committed, so a failed create would leave the
  // experiment renamed for a flag that does not exist.
  const renamedFrom =
    trackingKey && trackingKey !== originalTrackingKey
      ? originalTrackingKey
      : null;
  let created: { feature: FeatureInterface; version: number };
  try {
    created = await createManagedFeatureForExperiment({
      context,
      experiment,
      valueType,
      variations,
      sparse,
      // Always explicit: without it a racing duplicate would be suffixed away
      // silently, leaving the experiment owning two flags.
      featureId: featureId ?? keyPlan.derivedId,
      eventAudit: eventAudit,
      audit: audit,
    });
  } catch (e) {
    if (renamedFrom !== null) {
      await updateExperiment({
        context,
        experiment,
        changes: { trackingKey: renamedFrom },
      });
    }
    throw e;
  }

  await updateExperiment({
    context,
    experiment,
    changes: { implementationType: "values" },
  });
  await audit({
    event: "feature.create",
    entity: { object: "feature", id: created.feature.id },
    details: auditDetailsCreate(created.feature),
  });

  return created;
}

// Appends to the open draft or starts one. No experiment-status gate, unlike
// `postExperimentFeatureValues`: a managed flag has no Feature Flag page to
// send a running experiment to.
// Stages the flag-level fields the values imply, on the same draft: the value
// type when it moves, and the default value, which tracks control so sparse
// patches never merge onto a baseline nobody chose.
export async function stageManagedFeatureFields({
  context,
  feature,
  revision,
  valueType,
  defaultValue,
  eventAudit,
}: {
  context: ReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  /** Omit to keep the type the flag already has. */
  valueType?: FeatureValueType;
  /** Control's value. Omit to leave the default alone. */
  defaultValue?: string;
  eventAudit: EventUser;
}): Promise<FeatureRevisionInterface> {
  // Against the draft, not the feature: an earlier edit on this same draft may
  // already have staged either field — including a re-type being undone.
  const draftType = revision.metadata?.valueType ?? feature.valueType;
  const typeChanged = valueType !== undefined && valueType !== draftType;
  const defaultChanged =
    defaultValue !== undefined && defaultValue !== revision.defaultValue;
  // Holdout users get control too, and nothing else can edit a managed flag's
  // holdout value.
  const holdout =
    defaultChanged &&
    revision.holdout &&
    revision.holdout.value !== defaultValue
      ? { ...revision.holdout, value: defaultValue }
      : undefined;

  if (!typeChanged && !defaultChanged) return revision;

  const updated = await updateRevision(
    context,
    feature,
    revision,
    {
      ...(typeChanged && {
        // Merged, not replaced: `updateRevision` writes `metadata` wholesale, so
        // anything else already staged on this draft would be dropped.
        metadata: { ...revision.metadata, valueType },
      }),
      ...(defaultChanged && { defaultValue }),
      ...(holdout && { holdout }),
    },
    {
      user: eventAudit,
      action: typeChanged ? "change value type" : "change default value",
      subject: typeChanged
        ? `from ${draftType} to ${valueType}`
        : "to match the control variation",
      value: JSON.stringify({
        ...(typeChanged && { valueType }),
        ...(defaultChanged && { defaultValue }),
      }),
    },
  );
  if (!updated) {
    throw new Error(
      `Could not stage the Feature Flag changes on "${feature.id}"`,
    );
  }
  return updated;
}

export async function updateManagedVariationValues({
  context,
  experiment,
  variations,
  valueType,
  sparse,
  eventAudit,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  variations: ExperimentRefVariation[];
  /** Re-types the flag. Omit to keep the type it already has. */
  valueType?: FeatureValueType;
  sparse?: boolean;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<{ feature: FeatureInterface; version: number }> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    throw new NotFoundError("This experiment does not manage a Feature Flag.");
  }

  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  // An open draft may already have re-typed the flag; measure against it, not live.
  const openDraft = await getActiveDraft(context, feature);
  const baseType = openDraft?.metadata?.valueType ?? feature.valueType;
  const targetType = valueType ?? baseType;
  const typeChanged = targetType !== baseType;

  // Against the type the values are landing as, not the one being replaced.
  const values = normalizeManagedVariationValues({
    experiment,
    valueType: targetType,
    variations,
  });

  // Discarding a flag's first draft leaves it with no experiment rule anywhere.
  // Recreate the rule the way creation did instead of refusing every edit.
  const liveInfo = (await getLinkedFeatureInfo(context, experiment)).find(
    (f) => f.feature.id === feature.id,
  );
  if (!openDraft && !liveInfo?.liveHasMatchingRule) {
    const linked = await linkFeatureToExperiment({
      context,
      experiment,
      feature,
      rule: {
        type: "experiment-ref",
        description: "",
        id: "",
        allEnvironments: true,
        condition: "",
        enabled: true,
        scheduleRules: [],
        experimentId: experiment.id,
        variations: values,
        ...(sparse ? { sparse: true } : {}),
      },
      eventAudit,
      audit,
      autoPublish: false,
      forceNewDraft: true,
    });
    const fresh = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: linked.version,
    });
    if (!fresh) {
      throw new Error(
        `Could not read back the draft created on "${feature.id}"`,
      );
    }
    await stageManagedFeatureFields({
      context,
      feature,
      revision: fresh,
      ...(typeChanged && { valueType: targetType }),
      defaultValue: values[0].value,
      eventAudit,
    });
    await requestReviewForManagedDraft({
      context,
      feature,
      version: linked.version,
      eventAudit,
    });
    return { feature, version: linked.version };
  }

  const plans = await validateExperimentFeatureUpdates({
    context,
    experiment,
    linkedFeatures: [feature],
    features: {
      [feature.id]: {
        variations: values,
        ...(sparse === undefined ? {} : { sparse }),
        ...(typeChanged ? { valueType: targetType } : {}),
        revisionOptions: openDraft
          ? { targetVersion: openDraft.version }
          : { forceNewDraft: true },
      },
    },
  });

  // No plan means nothing is changing — neither the values nor the type. Report
  // the revision they are on rather than opening an empty draft.
  const plan = plans[0];
  if (!plan) {
    return { feature, version: openDraft?.version ?? feature.version };
  }

  let revision =
    plan.existingRevision ??
    (await getDraftRevision(context, feature, feature.version));

  // Control drives the flag's default, so it is staged whenever either moves.
  revision = await stageManagedFeatureFields({
    context,
    feature,
    revision,
    ...(typeChanged && { valueType: targetType }),
    defaultValue: values[0].value,
    eventAudit,
  });

  revision = await updateExperimentRefVariations({
    context,
    feature,
    revision,
    matchingRules: plan.matchingRules,
    updatedVariationValues: values,
    sparse,
    user: eventAudit,
  });

  if (
    await discardManagedDraftIfNoop({ context, feature, revision, eventAudit })
  ) {
    return { feature, version: feature.version };
  }

  // A managed flag has no separate "request review" step — editing is the request.
  await requestReviewForManagedDraft({
    context,
    feature,
    version: revision.version,
    eventAudit,
  });

  return { feature, version: revision.version };
}

// Merges server-side: `postFeaturePublish` wants a caller-supplied merge result
// from its diff view, which this surface has none of.
export async function publishManagedDraft({
  context,
  experiment,
  bypassApproval = false,
  forceStaleBase,
  comment = "",
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  /** Skip a required approval. Callers decide authority; the UI asks per publish. */
  bypassApproval?: boolean;
  /** Publish over a stale base without rebasing. Defaults to `bypassApproval`. */
  forceStaleBase?: boolean;
  comment?: string;
  audit?: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<FeatureInterface> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    throw new NotFoundError("This experiment does not manage a Feature Flag.");
  }
  if (experiment.status === "draft") {
    throw new BadRequestError(
      "Pending variation values publish when the experiment starts.",
    );
  }
  const revision = await getActiveDraft(context, feature);
  if (!revision) {
    throw new BadRequestError("There are no pending variation values.");
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
  const bypass = bypassApproval;
  const forceStale = forceStaleBase ?? bypass;

  // The same gate model as a Feature Revision publish, with resolutions that
  // point at this surface's routes rather than the locked flag routes.
  const routeBase = `/experiments/${experiment.id}/variation-values`;
  const gates: PublishGate[] = [];
  // Approvals on a managed flag must stand against the current live state; the
  // same authority that skips approval skips this.
  if (rebaseRequired && !forceStale) {
    gates.push(
      makeBlockingGate({
        type: "stale-base",
        messages: [
          "The Feature Flag changed after these values were drafted or approved.",
        ],
        requiresPermission: bypassApprovalPermission("feature"),
        resolution: {
          action: "rebase",
          method: "POST",
          path: `${routeBase}/rebase`,
        },
      }),
    );
  }
  // The same question the publish button and an auto-start ask, so a draft
  // that only stages an environment toggle is judged too.
  const approval = mergeResult.success
    ? await assessRevisionApprovalForAutoPublish(
        context,
        feature,
        revision,
        live,
        base,
        mergeResult,
      )
    : null;
  if (approval && !approval.satisfied && !bypass) {
    gates.push(
      makeBlockingGate({
        type: "approval-required",
        messages: [
          `Requires approval before publishing (status: "${revision.status}").`,
        ],
        requiresPermission: bypassApprovalPermission("feature"),
        resolution: {
          action: "request-review",
          method: "POST",
          path: `${routeBase}/request-review`,
        },
      }),
    );
  }
  if (!mergeResult.success) {
    gates.unshift(
      makeBlockingGate({
        type: "merge-conflict",
        messages: [
          "The pending values conflict with changes made directly on the Feature Flag.",
        ],
        resolution: {
          action: "discard",
          method: "POST",
          path: `${routeBase}/discard`,
        },
      }),
    );
    throw new PublishBlockedError(gates);
  }
  if (gates.length) throw new PublishBlockedError(gates);

  const published = await publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    bypassLockdown: bypass,
  });
  await audit?.({
    event: "feature.publish",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, published, {
      revision: revision.version,
      comment,
    }),
  });
  return published;
}

/** Clears the ownership marker only; content and history are untouched. */
export async function ejectManagedFeature({
  context,
  feature,
  experimentId,
  audit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  experimentId: string;
  audit?: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<FeatureInterface> {
  if (!isManagedByExperiment(feature, experimentId)) {
    throw new Error(
      `Feature Flag "${feature.id}" is not managed by this experiment.`,
    );
  }
  // Publish-class, not draft-class: this writes the live document and hands back
  // the ability to change what a running experiment serves. Draft authority would
  // grant a drafter exactly the publish they were not given.
  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(
        getEnabledEnvironments(
          feature,
          getEnvironments(context.org).map((e) => e.id),
        ),
      ),
    )
  ) {
    context.permissions.throwPermissionError();
  }
  // A deleted experiment leaves nothing to update; an unreadable one must not
  // be left claiming a flag it no longer manages.
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment && (await experimentIdExists(context.org.id, experimentId))) {
    throw new PermissionError(
      `Experiment "${experimentId}" manages this Feature Flag but you cannot access it, so the flag cannot be converted from here.`,
    );
  }
  // Both sides change: the flag stops being managed and the experiment's type
  // moves, so the flag-side route needs the same experiment authority.
  if (experiment && !context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  const unmanaged = await clearManagedMarker(context, feature);
  if (experiment) {
    await updateExperiment({
      context,
      experiment,
      changes: { implementationType: "feature" },
    });
  }
  await audit?.({
    event: "feature.update",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, unmanaged),
  });
  return unmanaged;
}

// Cleanup, moves and starts write to every flag the experiment touches, so a
// flag the caller cannot read must stop the operation rather than be skipped:
// skipping it is how rules and markers outlive their experiment.
export async function assertLinkedFlagsReadable(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  const ids = Array.from(
    new Set([
      ...(experiment.linkedFeatures ?? []),
      ...(await getManagedFlagIdsUnfiltered(context, experiment.id)),
    ]),
  );
  if (!ids.length) return;
  const existing = await getFeatureProjectsByIds(context, ids);
  const readable = new Set(
    (await getFeaturesByIds(context, ids)).map((f) => f.id),
  );
  const unreadable = Array.from(existing.keys()).filter(
    (id) => !readable.has(id),
  );
  if (!unreadable.length) return;
  const list = unreadable.map((id) => `"${id}"`).join(", ");
  throw new PermissionError(
    unreadable.length === 1
      ? `Feature Flag ${list} is linked to this experiment but you cannot access it, so this change cannot be made. Ask someone with access to that Feature Flag's project.`
      : `Feature Flags ${list} are linked to this experiment but you cannot access them, so this change cannot be made. Ask someone with access to those Feature Flags' projects.`,
  );
}

// Includes flags the caller cannot read: deletion must never leave one pointing
// at an experiment that no longer exists. No flag-side authority check: the
// flag existed only for the experiment, and the experiment's delete authority
// was checked by the caller. The flag existed only for the
// experiment, so it is archived rather than left serving control forever.
export async function clearManagedMarkersForExperiment(
  context: ReqContext | ApiReqContext,
  experimentId: string,
  // A flag that now carries the released value as its own rule stays live.
  { archive = true }: { archive?: boolean } = {},
): Promise<void> {
  const ids = await getManagedFlagIdsUnfiltered(context, experimentId);
  const features: FeatureInterface[] = [];
  for (const id of ids) {
    const feature = await getFeature(context, id);
    // Runs before the experiment goes away and before any flag is touched, so
    // refusing here leaves nothing half-released or locked to a dead experiment.
    if (!feature) {
      throw new PermissionError(
        `Feature Flag "${id}" is managed by this experiment but you cannot access it, so the experiment cannot be removed. Ask someone with access to that Feature Flag's project.`,
      );
    }
    features.push(feature);
  }
  // Archive first: an archived flag that is still managed can be ejected later,
  // an unmanaged live flag that failed to archive has no owner surface at all.
  for (const feature of features) {
    const toRelease = archive
      ? await archiveFeature(context, feature, true)
      : feature;
    await clearManagedMarker(context, toRelease);
  }
}

// Leaving Values hands the flag back: Feature Flag keeps it as an ordinary
// linked flag, anything else deletes it. Draft experiments only.
export async function releaseManagedFlagForImplementationChange({
  context,
  experiment,
  next,
  audit,
  acknowledged = false,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  next: ImplementationType;
  audit?: (data: AuditInterfaceInput) => Promise<void>;
  /** Deleting the flag is irreversible, so it must be acknowledged (`ignoreWarnings`). */
  acknowledged?: boolean;
}): Promise<ExperimentInterface> {
  if (next === "values") return experiment;
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) return experiment;
  if (next !== "feature" && !acknowledged) {
    throw new SoftWarningError(
      "Changing the implementation type deletes the managed Feature Flag.",
      [
        `Changing the implementation type from Values deletes managed Feature Flag "${feature.id}" and any pending variation values.`,
      ],
    );
  }
  if (next === "feature") {
    await ejectManagedFeature({
      context,
      feature,
      experimentId: experiment.id,
      audit,
    });
  } else {
    await removeManagedFeatureForExperiment(context, experiment, audit);
  }
  return (await getExperimentById(context, experiment.id)) ?? experiment;
}

export async function removeManagedFeatureForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  audit?: (data: AuditInterfaceInput) => Promise<void>,
): Promise<void> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    throw new NotFoundError("This experiment does not manage a Feature Flag.");
  }
  if (experiment.status !== "draft") {
    throw new BadRequestError(
      "The managed Feature Flag can only be removed while the experiment is a draft.",
    );
  }
  if (
    !context.permissions.canDeleteFeature(
      feature,
      Array.from(
        getEnabledEnvironments(
          feature,
          getEnvironments(context.org).map((e) => e.id),
        ),
      ),
    )
  ) {
    context.permissions.throwPermissionError();
  }
  await deleteFeature(context, feature);
  await unlinkFeatureFromExperiment(context, experiment.id, feature.id);
  await audit?.({
    event: "feature.delete",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsDelete(feature),
  });
}

/** Eject from the flag's side; the only write the lockdown lets through. */
export async function ejectManagedFeatureFromFlag(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  audit?: (data: AuditInterfaceInput) => Promise<void>,
): Promise<FeatureInterface> {
  const experimentId = managedByExperimentId(feature);
  if (!experimentId) {
    throw new BadRequestError(
      `Feature Flag "${feature.id}" is not managed by an experiment.`,
    );
  }
  return ejectManagedFeature({ context, feature, experimentId, audit });
}

// A change edited back to what serves would otherwise leave a pending review
// behind with nothing in it.
export async function discardManagedDraftIfNoop({
  context,
  feature,
  revision,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  eventAudit: EventUser;
}): Promise<boolean> {
  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
  const { mergeResult } = mergeDraftForAutoPublish(
    context,
    feature,
    revision,
    live,
    base,
  );
  if (!mergeResult.success || mergeResultHasChanges(mergeResult)) return false;
  await discardRevision(context, revision, eventAudit, feature.version);
  return true;
}

// The flag is where the project reaches the SDK payload and where its own
// permissions resolve, so it moves with the experiment.
export async function assertManagedFlagCanMove(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  project: string,
): Promise<void> {
  await assertLinkedFlagsReadable(context, experiment);
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature || (feature.project ?? "") === project) return;
  // Lands on the live document, so publish authority on both sides — the same
  // rule `putFeature` applies to a project move.
  const envs = Array.from(
    getEnabledEnvironments(
      feature,
      getEnvironments(context.org).map((e) => e.id),
    ),
  );
  if (
    !context.permissions.canPublishFeature(feature, envs) ||
    !context.permissions.canPublishFeature({ project }, envs)
  ) {
    context.permissions.throwPermissionError();
  }
}

export async function moveManagedFlagWithExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  const project = experiment.project ?? "";
  if (!feature || (feature.project ?? "") === project) return;
  await updateFeature(context, feature, { project });
}

// No authority check; for callers that established their own, notably deletion.
async function clearManagedMarker(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureInterface> {
  return updateFeature(context, feature, {}, { unsetManagedBy: true });
}

/** GET/HEAD/OPTIONS read state and are always allowed on a managed flag. */
function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

// POSTs the lockdown lets through: reads that happen to be POSTs, and the eject
// that ends the lockdown itself.
const LOCKDOWN_EXEMPT_POST_PATHS = [/\/eval$/, /\/eject-managed$/];

/** Mounted ahead of the route table so later feature routes are covered too. */
export const blockManagedFeatureWrites: RequestHandler = (req, _res, next) => {
  if (!isMutatingMethod(req.method)) return next();
  if (LOCKDOWN_EXEMPT_POST_PATHS.some((re) => re.test(req.path))) return next();
  const featureId = req.params?.id;
  if (!featureId) return next();
  assertFeatureNotManaged(getContextFromReq(req as AuthRequest), featureId)
    .then(() => next())
    .catch(next);
};

/** Ownership is read off the feature, never the experiment — one source. */
export async function getManagedFeatureForExperiment(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<FeatureInterface | null> {
  for (const featureId of experiment.linkedFeatures ?? []) {
    const feature = await getFeature(context, featureId);
    if (feature && isManagedByExperiment(feature, experiment.id)) {
      return feature;
    }
  }
  return null;
}

// Rewrites the managed-flag path into the `(id, version)` the feature
// controllers take. The ownership re-check is load-bearing: without it this
// route would drive any feature around the lockdown.
function makeResolveManagedFlagParams({
  allowExplicitVersion = false,
}: { allowExplicitVersion?: boolean } = {}): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const context = getContextFromReq(req as AuthRequest);
      const experimentId = req.params?.id;
      if (!experimentId) throw new NotFoundError("Experiment not found");

      const experiment = await getExperimentById(context, experimentId);
      if (!experiment) throw new NotFoundError("Experiment not found");

      const feature = await getManagedFeatureForExperiment(context, experiment);
      if (!feature) {
        throw new NotFoundError(
          "This experiment does not manage a Feature Flag.",
        );
      }

      const requested = allowExplicitVersion
        ? Number((req.body as { version?: unknown } | undefined)?.version)
        : NaN;

      if (Number.isFinite(requested)) {
        const revision = await getRevision({
          context,
          organization: feature.organization,
          featureId: feature.id,
          feature,
          version: requested,
        });
        if (!revision) throw new NotFoundError("Revision not found");
        req.params.version = String(revision.version);
      } else {
        const draft = await getActiveDraft(context, feature);
        if (!draft) {
          throw new NotFoundError(
            "This experiment's Feature Flag has no draft awaiting review.",
          );
        }
        req.params.version = String(draft.version);
      }

      req.params.id = feature.id;
    })()
      .then(() => next())
      .catch(next);
  };
}

export const resolveManagedFlagParams = makeResolveManagedFlagParams();
export const resolveManagedFlagCommentParams = makeResolveManagedFlagParams({
  allowExplicitVersion: true,
});

// Guards both entry points; middleware alone would miss the agent dispatcher.
export function guardManagedFeatureRoutes(
  routes: OpenApiRoute[],
): OpenApiRoute[] {
  return routes.map((route) => {
    if (!route.method || !isMutatingMethod(route.method)) return route;
    // Comments are conversation, not flag content, so they stay editable.
    if (/\/log\/:logId$/.test(route.path ?? "")) return route;

    const inner = route.rawHandler;
    const rawHandler: OpenApiRoute["rawHandler"] = async (req) => {
      const featureId = (req.params as { id?: string } | undefined)?.id;
      if (featureId) {
        await assertFeatureNotManaged(req.context, featureId, "rest");
      }
      return inner(req);
    };

    // Mirrors createApiRequestHandler's wrapper so shaping stays identical.
    const handler: OpenApiRoute["handler"] = async (req, res, next) => {
      try {
        const { status, body } = await runApiHandler(
          req,
          route.schemas,
          rawHandler as (req: never) => Promise<unknown>,
        );
        return res.status(status).json(body);
      } catch (e) {
        next(e);
      }
    };

    return { ...route, handler, rawHandler };
  });
}
