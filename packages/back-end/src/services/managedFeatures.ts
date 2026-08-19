import { RequestHandler } from "express";
import {
  copyManagedVariationValues,
  isManagedByExperiment,
  checkIfRevisionNeedsReview,
  isManagedFeature,
  managedFeatureKeyCandidate,
  seedManagedVariationValues,
} from "shared/util";
import {
  ExperimentInterface,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureValueType,
} from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ApiReqContext } from "back-end/types/api";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { OpenApiRoute, runApiHandler } from "back-end/src/util/handler";
import {
  createFeature,
  deleteFeature,
  featureIdExists,
  getFeature,
  publishRevision,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import {
  getActiveDraft,
  getRevision,
  markRevisionAsReviewRequested,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getExperimentById,
  getExperimentByTrackingKey,
} from "back-end/src/models/ExperimentModel";
import { ManagedFeatureError, NotFoundError } from "back-end/src/util/errors";
import {
  getContextFromReq,
  getEnvironments,
} from "back-end/src/services/organizations";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { logger } from "back-end/src/util/logger";
import {
  ExperimentFeatureLinkResult,
  linkFeatureToExperiment,
  mergeDraftForAutoPublish,
} from "back-end/src/services/experiment-feature";

// Guards live at the request entry points (Express routes and the agent
// dispatcher), not the model layer: the model can't tell a direct user edit from
// the experiment's own start/stop/holdout/ramp writes, which must keep working.

export function assertLoadedFeatureNotManaged(feature: FeatureInterface): void {
  if (!isManagedFeature(feature)) return;
  throw new ManagedFeatureError({
    featureId: feature.id,
    experimentId:
      feature.managedBy?.type === "experiment"
        ? feature.managedBy.experimentId
        : "",
  });
}

export async function assertFeatureNotManaged(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<void> {
  const feature = await getFeature(context, featureId);
  // Missing or unreadable is the handler's 404 to raise, not ours.
  if (!feature) return;
  assertLoadedFeatureNotManaged(feature);
}

const MAX_KEY_ATTEMPTS = 10;

function isDuplicateKeyError(e: unknown): boolean {
  return (e as { code?: number } | null)?.code === 11000;
}

export type CreateManagedFeatureInput = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  valueType: FeatureValueType;
  /** One value per experiment variation, in variation order. */
  variations: ExperimentRefVariation[];
  sparse?: boolean;
  /**
   * Create the flag under exactly this id instead of deriving one from the
   * tracking key. A collision surfaces as a conflict instead of being suffixed
   * away: the caller that passes this (adding a managed flag to an existing
   * experiment) has UI to resolve it, whereas experiment creation has none.
   */
  featureId?: string;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

/** Mirrors the charset `postFeatures` enforces, for ids a user typed. */
const FEATURE_KEY_PATTERN = /^[a-zA-Z0-9_.:|-]+$/;

/**
 * Ids in `linkedFeatures` that no longer resolve to a feature — left behind when
 * a flag is deleted out of band. Unfiltered on purpose: a feature the caller
 * cannot read still exists and is still linked.
 */
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

/**
 * Whether this experiment can still adopt a managed flag. Managed mode owns the
 * experiment's whole delivery, so it can only be taken on while nothing else is
 * wired up and nothing is live yet.
 *
 * Counts linked features that actually exist rather than trusting the array: a
 * flag deleted out of band leaves its id behind, and that must not permanently
 * bar the experiment from adopting a new one.
 */
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
  return null;
}

export type ManagedFlagKeyPlan = {
  /** The id the tracking key sanitizes to — what gets created if it is free. */
  derivedId: string;
  derivedIdAvailable: boolean;
  /** True when sanitizing changed the key, so the two cannot match exactly. */
  sanitized: boolean;
  /**
   * A free key/id pair, offered only when `derivedId` is taken. Adopting it
   * renames the experiment's tracking key so the two match character for
   * character.
   */
  suggestedPair: { trackingKey: string; featureId: string } | null;
  /** Set when the org's feature key format rejects `derivedId`. */
  regexError: string | null;
};

const MAX_PAIR_SUGGESTIONS = 25;

/**
 * What the adoption modal needs to describe the key situation before any write.
 * Availability is authoritative for the feature id (unique index) but advisory
 * for the tracking key: its uniqueness is not indexed and the lookup is
 * read-scoped, so a key held in a project the caller cannot see reads as free.
 */
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

/**
 * Creates the flag disabled everywhere and stages its experiment-ref rule as a
 * draft; `linkFeatureToExperiment` puts the env toggles in that same draft, so
 * nothing serves until the experiment starts and publishes it.
 */
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

  if (!variations.length) {
    throw new Error(
      "A managed Feature Flag requires a value for every variation",
    );
  }

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

  // The key is derived, not typed, so an org key regex can reject something the
  // user never chose — say so rather than failing on the insert.
  const regexValidator = org.settings?.featureRegexValidator;

  const baseFeature: Omit<FeatureInterface, "id"> = {
    organization: org.id,
    owner: userId,
    description: experiment.description || "",
    project,
    tags: experiment.tags || [],
    valueType,
    defaultValue: variations[0].value,
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
      ? { id: experiment.holdoutId, value: variations[0].value }
      : undefined,
    managedBy: { type: "experiment", experimentId: experiment.id },
  };

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
      // createFeature also writes the initial revision; re-read the stored doc.
      created = await getFeature(context, id);
      break;
    } catch (e) {
      // The index is the arbiter; take the next candidate rather than racing.
      if (!isDuplicateKeyError(e)) throw e;
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
        variations,
        ...(sparse ? { sparse: true } : {}),
      },
      eventAudit,
      audit,
      // Managed flags always start as a draft; the experiment's start publishes
      // it, and later edits go through a new draft the same way.
      autoPublish: false,
      forceNewDraft: true,
    });

    // Inside the compensation boundary: a throw here (event dispatch, revision
    // re-read) would otherwise strand a created, linked, permanently locked flag
    // while the caller deletes the experiment.
    await requestReviewForManagedDraft({
      context,
      feature: created,
      version: linked.version,
      eventAudit,
    });
  } catch (e) {
    await deleteFeature(context, created);
    throw e;
  }

  return { feature: created, version: linked.version };
}

const MAX_SOURCE_READ_ATTEMPTS = 3;

/**
 * Null when there is nothing safe to copy — no managed source, or the source
 * kept changing while we read it. Callers seed a fresh flag instead of failing.
 */
export async function readManagedValuesForDuplicate({
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
} | null> {
  for (let attempt = 0; attempt < MAX_SOURCE_READ_ATTEMPTS; attempt++) {
    const before = await getManagedFeatureForExperiment(
      context,
      sourceExperiment,
    );
    if (!before) return null;

    // CAS on the REVISION, not the feature: getLinkedFeatureInfo reads values out
    // of the revision, and updateRevision stamps only that document — comparing
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
        valueType: before.valueType,
        variations: copyManagedVariationValues({
          sourceValues: info.values,
          sourceVariations: sourceExperiment.variations,
          targetVariations: targetExperiment.variations,
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

/**
 * A managed draft goes straight into review — there is no separate "request
 * review" step to click. No-op when approvals aren't required for this flag, so
 * orgs without review land in plain `draft` and publish at experiment start.
 */
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
    allEnvironments: context.environments,
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

/**
 * Create the managed flag for a newly created experiment, copying the source's
 * type and values when it was duplicated from a managed one. A copy can fail
 * where a fresh flag won't (a value the schema now rejects), so it falls back
 * to seeded values rather than failing the create outright.
 */
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
  const seeded = {
    valueType: "string" as FeatureValueType,
    variations: seedManagedVariationValues(experiment.variations),
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
      eventAudit,
      audit,
    });

  try {
    await create(copied ?? seeded);
  } catch (e) {
    if (!copied) throw e;
    logger.warn(
      { experiment: experiment.id, error: e.message },
      "Copying the managed Feature Flag for a duplicate failed; seeding a fresh one",
    );
    await create(seeded);
  }
}

/**
 * Publish the managed flag's open draft, merging server-side.
 * `postFeaturePublish` expects a caller-supplied `mergeResultSerialized`
 * computed from its diff view; the managed surface has none, so reusing that
 * controller made every publish fail its "something changed" check.
 */
export async function publishManagedDraft({
  context,
  experiment,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
}): Promise<FeatureInterface> {
  const feature = await getManagedFeatureForExperiment(context, experiment);
  if (!feature) {
    throw new NotFoundError("This experiment does not manage a Feature Flag.");
  }
  const revision = await getActiveDraft(context, feature);
  if (!revision) {
    throw new NotFoundError("This Feature Flag has no draft to publish.");
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
  // Neither state has a remedy on this surface — the managed flag has no rebase
  // or conflict UI — so both messages name the way out.
  if (!mergeResult.success) {
    throw new Error(
      "This Feature Flag's draft conflicts with its live version. Switch to a manual implementation to resolve the conflict on the Feature Flag page.",
    );
  }
  if (rebaseRequired) {
    throw new Error(
      "This Feature Flag's draft is behind its live version and your organization requires a rebase before publishing. Switch to a manual implementation to rebase it on the Feature Flag page.",
    );
  }

  return publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment: "",
    bypassLockdown: context.permissions.canBypassFlagApprovalChecks(
      feature,
      "feature",
    ),
  });
}

/** Clears the ownership marker only; content and history are untouched. */
export async function ejectManagedFeature({
  context,
  feature,
  experimentId,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  experimentId: string;
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
  return clearManagedMarker(context, feature);
}

/**
 * The marker write with no authority check. Callers that already established
 * their own authority use this — notably experiment deletion, which must never
 * be blocked into leaving an unrecoverable flag behind.
 */
export async function clearManagedMarker(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureInterface> {
  return updateFeature(context, feature, {}, { unsetManagedBy: true });
}

/** GET/HEAD/OPTIONS read state and are always allowed on a managed flag. */
function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * POSTs that compute a response without touching the flag. Blocking these would
 * break the flag's own page (the value simulator) while protecting nothing.
 */
const READ_ONLY_POST_PATHS = [/\/eval$/];

/** Mounted ahead of the route table so later feature routes are covered too. */
export const blockManagedFeatureWrites: RequestHandler = (req, _res, next) => {
  if (!isMutatingMethod(req.method)) return next();
  if (READ_ONLY_POST_PATHS.some((re) => re.test(req.path))) return next();
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

/**
 * Rewrites `/experiment/:id/managed-flag/<action>` into the `(id, version)` the
 * feature controllers already take, so they're reused verbatim.
 *
 * The ownership re-check is load-bearing: without it this route would drive any
 * feature around the lockdown.
 *
 * `allowExplicitVersion` lets a route address a specific revision by body
 * `version` instead of the active draft. Only the comment route uses it: a
 * conversation stays editable after its draft publishes, whereas a review action
 * must always land on the draft under review.
 */
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

/**
 * Guards both ways a route can be invoked: the Express `handler` and the agent
 * dispatcher's `rawHandler`. Middleware alone would miss the dispatcher, which
 * never runs it.
 */
export function guardManagedFeatureRoutes(
  routes: OpenApiRoute[],
): OpenApiRoute[] {
  return routes.map((route) => {
    if (!route.method || !isMutatingMethod(route.method)) return route;

    const inner = route.rawHandler;
    const rawHandler: OpenApiRoute["rawHandler"] = async (req) => {
      const featureId = (req.params as { id?: string } | undefined)?.id;
      if (featureId) await assertFeatureNotManaged(req.context, featureId);
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
