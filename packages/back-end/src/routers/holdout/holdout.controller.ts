import type { Response } from "express";
import { getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { v4 as uuidv4 } from "uuid";
import { generateVariationId } from "shared/util";
import { omit } from "lodash";
import { HoldoutInterface } from "back-end/src/validators/holdout";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
} from "back-end/types/experiment";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
  getExperimentsByIds,
  hasArchivedExperiments,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getFeature,
  getFeaturesByIds,
  removeHoldoutFromFeature,
} from "back-end/src/models/FeatureModel";
import { FeatureInterface } from "back-end/types/feature";
import { logger } from "back-end/src/util/logger";
import {
  createExperimentSnapshot,
  SNAPSHOT_TIMEOUT,
  validateVariationIds,
} from "back-end/src/controllers/experiments";
import { validateExperimentData } from "back-end/src/services/experiments";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { EventUserForResponseLocals } from "back-end/types/events/event-types";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { DataSourceInterface } from "back-end/types/datasource";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/holdouts";
import { refreshSDKPayloadCache } from "back-end/src/services/features";

/**
 * GET /holdout/:id
 * Get the holdout and its accompanying experiment
 * @param req
 * @param res
 */
export const getHoldout = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200 | 404;
    holdout?: HoldoutInterface;
    experiment?: ExperimentInterface;
    linkedFeatures?: FeatureInterface[];
    linkedExperiments?: ExperimentInterface[];
    envs?: string[];
    message?: string;
  }>,
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({
      status: 404,
      message: "Holdout not found",
    });
  }

  const holdoutExperiment = await getExperimentById(
    context,
    holdout.experimentId,
  );

  if (!holdoutExperiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  const linkedFeatureIds = Object.keys(holdout.linkedFeatures);
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);
  const linkedExperiments = await getExperimentsByIds(
    context,
    linkedExperimentIds,
  );

  res.status(200).json({
    status: 200,
    holdout,
    experiment: holdoutExperiment,
    linkedFeatures,
    linkedExperiments,
    envs: Object.keys(holdout.environmentSettings).filter(
      (e) => holdout.environmentSettings[e].enabled,
    ),
  });
};

// endregion GET /holdout/:id

// region POST /holdout

export const createHoldout = async (
  req: AuthRequest<
    Partial<ExperimentInterfaceStringDates> & Partial<HoldoutInterface>,
    unknown,
    { autoRefreshResults?: boolean }
  >,
  res: Response<
    | {
        status: 200;
        experiment: ExperimentInterface;
        holdout: HoldoutInterface;
      }
    | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);
  const { org, userId } = context;

  const data = req.body;
  data.organization = org.id;

  if (
    !context.permissions.canCreateHoldout({ projects: data.projects || [] })
  ) {
    context.permissions.throwPermissionError();
  }

  let result:
    | { metricIds: string[]; datasource: DataSourceInterface | null }
    | undefined;

  try {
    result = await validateExperimentData(context, data);
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
    return;
  }

  const { metricIds, datasource } = result;
  const variations = [
    {
      name: "Holdout",
      description: "",
      key: "0",
      screenshots: [],
      id: generateVariationId(),
    },
    {
      name: "Treatment",
      description: "",
      key: "1",
      screenshots: [],
      id: generateVariationId(),
    },
  ];
  const obj: Omit<ExperimentInterface, "id" | "uid"> = {
    organization: data.organization,
    archived: false,
    hashAttribute: data.hashAttribute || "",
    fallbackAttribute: data.fallbackAttribute || "",
    hashVersion: 2,
    disableStickyBucketing: true,
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: "",
    owner: data.owner || userId,
    trackingKey: `holdout-${uuidv4()}`,
    datasource: data.datasource || "",
    exposureQueryId: data.exposureQueryId || "",
    userIdType: data.userIdType || "anonymous",
    name: data.name || "",
    phases: data.phases
      ? data.phases.map(({ dateStarted, dateEnded, ...phase }) => {
          return {
            ...phase,
            dateStarted: dateStarted ? getValidDate(dateStarted) : new Date(),
            dateEnded: dateEnded ? getValidDate(dateEnded) : undefined,
          };
        })
      : [],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: "",
    goalMetrics: data.goalMetrics || [],
    secondaryMetrics: data.secondaryMetrics || [],
    guardrailMetrics: [],
    activationMetric: "",
    metricOverrides: [],
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    variations,
    implementation: "code",
    status: "draft",
    results: undefined,
    analysis: "",
    releasedVariationId: "",
    excludeFromPayload: true,
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    // todo: revisit this logic for project level settings, as well as "override stats settings" toggle:
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter:
      data.sequentialTestingTuningParameter ??
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: false,
    statsEngine: data.statsEngine,
    type: "holdout",
    customFields: data.customFields || undefined,
    shareLevel: data.shareLevel || "organization",
    decisionFrameworkSettings: {},
  };

  try {
    validateVariationIds(obj.variations);

    const experiment = await createExperiment({
      data: obj,
      context,
    });

    const holdout = await context.models.holdout.create({
      experimentId: experiment.id,
      projects: data.projects || [],
      name: experiment.name,
      environmentSettings: data.environmentSettings || {},
      linkedFeatures: {},
      linkedExperiments: {},
    });

    if (!holdout) {
      throw new Error("Failed to create holdout");
    }

    if (datasource && req.query.autoRefreshResults && metricIds.length > 0) {
      // This is doing an expensive analytics SQL query, so may take a long time
      // Set timeout to 30 minutes
      req.setTimeout(SNAPSHOT_TIMEOUT);

      try {
        await createExperimentSnapshot({
          context,
          experiment,
          datasource,
          dimension: "",
          phase: 0,
          useCache: true,
        });
      } catch (e) {
        logger.error(e, "Failed to auto-refresh imported experiment");
      }
    }

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    res.status(200).json({
      status: 200,
      experiment,
      holdout: holdout,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
};

// endregion POST /holdout

// region GET /holdouts

export const getHoldouts = async (
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
      includeArchived?: boolean;
    }
  >,
  res: Response<{
    status: 200 | 404;
    holdouts: HoldoutInterface[];
    experiments: ExperimentInterface[];
    hasArchived: boolean;
  }>,
) => {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const includeArchived = !!req.query?.includeArchived;

  const holdouts = await context.models.holdout.getAll();
  const experiments = await getAllExperiments(context, {
    includeArchived,
    type: "holdout",
  });

  const filteredHoldouts = project
    ? holdouts.filter((h) => {
        return h.projects.includes(project);
      })
    : holdouts;

  const hasArchived = includeArchived
    ? experiments.some((e) => e.archived)
    : await hasArchivedExperiments(context, project);

  res.status(200).json({
    status: 200,
    experiments,
    hasArchived,
    holdouts: filteredHoldouts,
  });
};

// endregion GET /holdouts

// region PUT /holdout/:id

export const updateHoldout = async (
  req: AuthRequest<Partial<HoldoutInterface>, { id: string }>,
  res: Response<
    | { status: 200; holdout?: HoldoutInterface }
    | { status: 404; message?: string }
  >,
) => {
  const context = getContextFromReq(req);
  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404, message: "Holdout not found" });
  }

  const experiment = await getExperimentById(context, holdout.experimentId);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Holdout experiment not found",
    });
  }

  const updatedHoldout = await context.models.holdout.update(holdout, req.body);
  return res.status(200).json({ status: 200, holdout: updatedHoldout });
};

// endregion PUT /holdout/:id

// region POST /holdout/:id/edit-status

export const editStatus = async (
  req: AuthRequest<
    {
      status: "stopped" | "running" | "draft";
      holdoutRunningStatus?: "running" | "analysis-period";
    },
    { id: string }
  >,
  res: Response<{ status: 200 | 404; message?: string }>,
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404, message: "Holdout not found" });
  }

  const experiment = await getExperimentById(context, holdout.experimentId);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Holdout experiment not found",
    });
  }

  if (!context.permissions.canUpdateHoldout(holdout, holdout)) {
    context.permissions.throwPermissionError();
  }

  let phases = [...experiment.phases] as ExperimentPhase[];

  if (req.body.status === "stopped" && experiment.status !== "stopped") {
    // put end date on both phases
    if (phases[0]) {
      phases[0].dateEnded = new Date();
    }
    if (phases[1]) {
      phases[1].dateEnded = new Date();
    }
    // set the status to stopped for the experiment
    await updateExperiment({
      context,
      experiment,
      changes: {
        phases,
        status: "stopped",
      },
    });

    await refreshSDKPayloadCache({
      context,
      payloadKeys: getAffectedSDKPayloadKeys(
        holdout,
        getEnvironmentIdsFromOrg(context.org),
      ),
    });
  } else if (req.body.status === "running") {
    // check to see if already in analysis period
    if (!phases[0]) {
      throw new Error("Holdout does not have a phase");
    }
    if (
      !phases[1] ||
      (phases[1] &&
        phases[1].dateEnded &&
        req.body.holdoutRunningStatus === "analysis-period")
    ) {
      phases[1] = {
        ...phases[0],
        lookbackStartDate: new Date(),
        dateEnded: undefined,
        name: "Analysis Period",
      };
      await context.models.holdout.update(holdout, {
        analysisStartDate: new Date(),
      });
      // check to see if we already are in the running phase
    } else if (
      ((phases[0] && !phases[0].dateEnded) || !!phases[1]) &&
      req.body.holdoutRunningStatus === "running"
    ) {
      phases[0] = {
        ...phases[0],
        dateEnded: undefined,
      };
      if (phases[1]) {
        phases = [phases[0]];
      }
      await context.models.holdout.update(holdout, {
        analysisStartDate: undefined,
      });
    }
    await updateExperiment({
      context,
      experiment,
      changes: { phases, status: "running" },
    });

    await refreshSDKPayloadCache({
      context,
      payloadKeys: getAffectedSDKPayloadKeys(
        holdout,
        getEnvironmentIdsFromOrg(context.org),
      ),
    });
  } else if (req.body.status === "draft") {
    // set the status to draft for the experiment
    phases[0].dateEnded = undefined;
    await updateExperiment({
      context,
      experiment,
      changes: { phases: [phases[0]], status: "draft" },
    });
    await context.models.holdout.update(holdout, {
      analysisStartDate: undefined,
    });

    await refreshSDKPayloadCache({
      context,
      payloadKeys: getAffectedSDKPayloadKeys(
        holdout,
        getEnvironmentIdsFromOrg(context.org),
      ),
    });
  }

  return res.status(200).json({ status: 200 });
};

// endregion POST /holdout/:id/start-analysis

// region DELETE /holdout/:id

export const deleteHoldout = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 | 404 | 403; message?: string }>,
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404, message: "Holdout not found" });
  }

  const experiment = await getExperimentById(context, holdout.experimentId);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Holdout experiment not found",
    });
    return;
  }

  if (experiment.organization !== context.org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  if (!context.permissions.canDeleteHoldout(holdout)) {
    context.permissions.throwPermissionError();
  }

  await deleteExperimentByIdForOrganization(context, experiment);

  // Remove holdout from linked features and linked experiments
  const linkedFeatureIds = Object.keys(holdout.linkedFeatures);
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);
  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);
  const linkedExperiments = await getExperimentsByIds(
    context,
    linkedExperimentIds,
  );

  // Remove holdout links from linked features and experiments
  await Promise.all(
    linkedFeatures.map((f) => removeHoldoutFromFeature(context, f)),
  );
  await Promise.all(
    linkedExperiments.map((e) =>
      updateExperiment({
        context,
        experiment: e,
        changes: { holdoutId: "" },
      }),
    ),
  );

  await context.models.holdout.delete(holdout);

  await refreshSDKPayloadCache({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      holdout,
      getEnvironmentIdsFromOrg(context.org),
    ),
  });

  return res.status(200).json({ status: 200 });
};

// endregion DELETE /holdout/:id

// region DELETE /holdout/:id/feature/:featureId

export const deleteHoldoutFeature = async (
  req: AuthRequest<null, { id: string; featureId: string }>,
  res: Response<{ status: 200 | 404 | 400; message?: string }>,
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404, message: "Holdout not found" });
  }

  const feature = await getFeature(context, req.params.featureId);

  if (!feature) {
    return res.status(404).json({ status: 404, message: "Feature not found" });
  }

  if (!feature.holdout) {
    return res.status(400).json({
      status: 400,
      message: "Feature is not linked to a holdout",
    });
  }

  if (
    !context.permissions.canUpdateFeature(feature, omit(feature, "holdout"))
  ) {
    context.permissions.throwPermissionError();
  }

  await removeHoldoutFromFeature(context, feature);

  await context.models.holdout.update(holdout, {
    linkedFeatures: omit(holdout.linkedFeatures, feature.id),
  });

  return res.status(200).json({ status: 200 });
};

// endregion DELETE /holdout/:id/feature/:featureId
