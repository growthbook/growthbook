import { RequestHandler } from "express";
import {
  copyManagedVariationValues,
  isManagedByExperiment,
  isManagedFeature,
  managedFeatureKeyCandidate,
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
  getFeature,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { getActiveDraft } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { ManagedFeatureError, NotFoundError } from "back-end/src/util/errors";
import {
  getContextFromReq,
  getEnvironments,
} from "back-end/src/services/organizations";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { logger } from "back-end/src/util/logger";
import {
  ExperimentFeatureLinkResult,
  linkFeatureToExperiment,
} from "back-end/src/services/experiment-feature";

/**
 * A Feature Flag in managed mode is owned by its experiment: it holds one
 * experiment-ref rule, and every change to it is made from the experiment page
 * (or the equivalent `/experiments/:id/managed-flag/*` REST routes). This module
 * is what makes that ownership real rather than advisory.
 *
 * The guard is applied at the two *request entry points* — Express routes and
 * the agent dispatcher — rather than in the model layer, because the model
 * cannot tell a user editing the flag directly from the experiment's own start,
 * stop, holdout and ramp flows writing through it. Those internal writes must
 * keep working; only inbound requests aimed at a feature route are refused.
 */

export async function assertFeatureNotManaged(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<void> {
  const feature = await getFeature(context, featureId);
  // A feature the caller can't read, or that doesn't exist, is the handler's
  // 404 to raise — not ours to pre-empt with a different status.
  if (!feature) return;
  if (!isManagedFeature(feature)) return;
  throw new ManagedFeatureError({
    featureId: feature.id,
    // Narrowed by isManagedFeature; the union has one member today.
    experimentId:
      feature.managedBy?.type === "experiment"
        ? feature.managedBy.experimentId
        : "",
  });
}

/**
 * How many key candidates to try before giving up. Each attempt is a real
 * insert; the unique `{id, organization}` index is what decides, so a rival
 * create taking the id mid-flight just costs one more attempt rather than
 * producing a duplicate. Ten is far past any realistic contention.
 */
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
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

/**
 * Create the Feature Flag an experiment manages and stage its single
 * experiment-ref rule as a draft. The flag starts disabled in every
 * environment; `linkFeatureToExperiment` flips on the rule's footprint inside
 * the draft, so nothing is served until that draft is published — which
 * happens when the experiment starts.
 */
export async function createManagedFeatureForExperiment({
  context,
  experiment,
  valueType,
  variations,
  sparse,
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

  // A managed flag's key is derived, not typed, so an org key regex can reject
  // something the user never chose. Say so plainly rather than failing on the
  // insert with a shape they can't act on.
  const regexValidator = org.settings?.featureRegexValidator;

  const baseFeature: Omit<FeatureInterface, "id"> = {
    organization: org.id,
    owner: userId,
    description: experiment.description || "",
    project,
    tags: experiment.tags || [],
    valueType,
    defaultValue: variations[0].value,
    // Disabled everywhere on create: the flag reaches no payload until its
    // draft publishes, so creation needs create authority alone.
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
      // Enabled nowhere on create, so the publish half is vacuous by
      // construction rather than by a hand-written empty list.
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

  let created: FeatureInterface | null = null;
  let lastCandidate = "";
  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
    const id = managedFeatureKeyCandidate({
      trackingKey: experiment.trackingKey,
      experimentId: experiment.id,
      attempt,
    });
    lastCandidate = id;

    if (regexValidator && !new RegExp(regexValidator).test(id)) {
      throw new Error(
        `The Feature Flag key derived from this experiment ("${id}") does not match your organization's feature key format (${regexValidator}). Rename the experiment tracking key, or turn off managed mode for this experiment.`,
      );
    }

    try {
      await createFeature(context, { ...baseFeature, id });
      // Re-read so the link step below works from the canonical stored doc
      // (createFeature also writes the initial revision) rather than our input.
      created = await getFeature(context, id);
      break;
    } catch (e) {
      // Someone else holds this key — the index is the arbiter, so take the
      // next candidate rather than pre-checking and racing.
      if (!isDuplicateKeyError(e)) throw e;
    }
  }

  if (!created) {
    throw new Error(
      `Could not find an available Feature Flag key for this experiment (tried up to "${lastCandidate}"). Rename the experiment tracking key and try again.`,
    );
  }

  // The flag and its rule are one unit: a flag with no experiment-ref rule is
  // a locked-down orphan nobody can edit or reach. If the link fails, undo the
  // create rather than leave that behind. Innermost step compensates itself,
  // so the caller only has to undo what it wrote.
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
  } catch (e) {
    await deleteFeature(context, created);
    throw e;
  }

  return { feature: created, version: linked.version };
}

/**
 * How many times to re-read the source flag when copying it for a duplicate.
 * Each attempt reads the values, then re-reads the flag to confirm it did not
 * move underneath us; a rival edit costs one more attempt.
 */
const MAX_SOURCE_READ_ATTEMPTS = 3;

/**
 * The type and values a duplicated experiment's managed flag should start with,
 * copied from the experiment it was duplicated from.
 *
 * Returns null when there is nothing safe to copy — no managed source, or the
 * source kept changing while we read it. Callers seed a brand new flag instead
 * of failing: a duplicate with fresh values is a far better outcome than an
 * experiment with no implementation and no way to add one.
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

    const info = (await getLinkedFeatureInfo(context, sourceExperiment)).find(
      (f) => f.feature.id === before.id,
    );
    if (!info) return null;

    // Compare-and-swap on the source: the values above came from a separate
    // read, so they only describe one point in time if the flag is unchanged
    // since. Otherwise we could copy a half-applied edit.
    const after = await getFeature(context, before.id);
    if (after && after.dateUpdated.getTime() === before.dateUpdated.getTime()) {
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
 * Release a flag from its experiment. The flag and its revision history are
 * untouched — only the ownership marker is cleared, which reopens every direct
 * write path and lets the experiment take other implementations again.
 */
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
  // Ejecting hands the flag back to ordinary editing, so it takes the same
  // authority an ordinary edit would.
  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  return updateFeature(context, feature, {}, { unsetManagedBy: true });
}

/** GET/HEAD/OPTIONS read state and are always allowed on a managed flag. */
function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * Express guard for the internal `/feature/*` routes. Mounted once, ahead of
 * the route table, so a feature route added later is covered without anyone
 * remembering to opt in.
 */
export const blockManagedFeatureWrites: RequestHandler = (req, _res, next) => {
  if (!isMutatingMethod(req.method)) return next();
  const featureId = req.params?.id;
  if (!featureId) return next();
  assertFeatureNotManaged(getContextFromReq(req as AuthRequest), featureId)
    .then(() => next())
    .catch(next);
};

/**
 * Find the flag an experiment manages, or null. Ownership is read off the
 * feature, never off the experiment, so there is one source of truth and
 * nothing to drift.
 */
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
 * Rewrite `/experiment/:id/managed-flag/<action>` into the `(id, version)` the
 * ordinary feature controllers already take, so those routes reuse the review
 * and publish logic verbatim instead of a parallel copy of it.
 *
 * The ownership re-check here is load-bearing: without it these routes would be
 * a way to drive any feature through an experiment path and around the
 * lockdown. A flag not managed by *this* experiment is refused.
 */
export const resolveManagedFlagParams: RequestHandler = (req, _res, next) => {
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

    const draft = await getActiveDraft(context, feature);
    if (!draft) {
      throw new NotFoundError(
        "This experiment's Feature Flag has no draft awaiting review.",
      );
    }

    req.params.id = feature.id;
    req.params.version = String(draft.version);
  })()
    .then(() => next())
    .catch(next);
};

/**
 * Wrap REST feature routes so a managed flag refuses direct writes on both
 * paths a route can be invoked by: the Express `handler` and the agent
 * dispatcher's `rawHandler`. Rebuilding both from one guarded inner handler
 * keeps it a single check — attaching Express middleware instead would leave
 * the dispatcher, which never runs middleware, guarded by a separate mechanism.
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

    // Mirrors the wrapper `createApiRequestHandler` builds, pointed at the
    // guarded inner handler so validation and error shaping stay identical.
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
