import { RequestHandler } from "express";
import {
  copyManagedVariationValues,
  isManagedByExperiment,
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

// Guards live at the request entry points (Express routes and the agent
// dispatcher), not the model layer: the model can't tell a direct user edit from
// the experiment's own start/stop/holdout/ramp writes, which must keep working.

export async function assertFeatureNotManaged(
  context: ReqContext | ApiReqContext,
  featureId: string,
): Promise<void> {
  const feature = await getFeature(context, featureId);
  // Missing or unreadable is the handler's 404 to raise, not ours.
  if (!feature) return;
  if (!isManagedFeature(feature)) return;
  throw new ManagedFeatureError({
    featureId: feature.id,
    experimentId:
      feature.managedBy?.type === "experiment"
        ? feature.managedBy.experimentId
        : "",
  });
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
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
};

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
      // createFeature also writes the initial revision; re-read the stored doc.
      created = await getFeature(context, id);
      break;
    } catch (e) {
      // The index is the arbiter; take the next candidate rather than racing.
      if (!isDuplicateKeyError(e)) throw e;
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

    const info = (await getLinkedFeatureInfo(context, sourceExperiment)).find(
      (f) => f.feature.id === before.id,
    );
    if (!info) return null;

    // The values came from a separate read, so they describe one point in time
    // only if the flag is unchanged since; otherwise we'd copy a partial edit.
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
  // Hands the flag back to ordinary editing, so it takes ordinary edit authority.
  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  return updateFeature(context, feature, {}, { unsetManagedBy: true });
}

/** GET/HEAD/OPTIONS read state and are always allowed on a managed flag. */
function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/** Mounted ahead of the route table so later feature routes are covered too. */
export const blockManagedFeatureWrites: RequestHandler = (req, _res, next) => {
  if (!isMutatingMethod(req.method)) return next();
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
