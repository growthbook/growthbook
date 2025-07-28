import type { Response } from "express";
import { getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { v4 as uuidv4 } from "uuid";
import { generateVariationId } from "shared/util";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
  getExperimentsByIds,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getFeaturesByIds,
  updateFeature,
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
import { EventUserForResponseLocals } from "back-end/src/events/event-types";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { HoldoutInterface } from "./holdout.validators";

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
  }>
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
    holdout.experimentId
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
    linkedExperimentIds
  );

  res.status(200).json({
    status: 200,
    holdout,
    experiment: holdoutExperiment,
    linkedFeatures,
    linkedExperiments,
    envs: Object.keys(holdout.environmentSettings).filter(
      (e) => holdout.environmentSettings[e].enabled
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
  >
) => {
  const context = getContextFromReq(req);
  const { org, userId } = context;

  const data = req.body;
  data.organization = org.id;

  if (!context.permissions.canCreateExperiment(data)) {
    context.permissions.throwPermissionError();
  }

  const result = await validateExperimentData(context, data, res);
  // If datasource or metrics are invalid, return
  if (!result) {
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

    // // Make sure id is unique
    // if (obj.trackingKey) {
    //   const existing = await getExperimentByTrackingKey(
    //     context,
    //     obj.trackingKey
    //   );
    //   if (existing) {
    //     return res.status(200).json({
    //       status: 200,
    //       duplicateTrackingKey: true,
    //       existingId: existing.id,
    //     });
    //   }
    // }

    const experiment = await createExperiment({
      data: obj,
      context,
    });

    const holdout = await context.models.holdout.create({
      experimentId: experiment.id,
      projects: experiment.project ? [experiment.project] : [],
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

    // await upsertWatch({
    //   userId,
    //   organization: org.id,
    //   item: experiment.id,
    //   type: "experiments",
    // });

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
  req: AuthRequest,
  res: Response<{
    status: 200 | 404;
    holdouts: HoldoutInterface[];
    experiments: ExperimentInterface[];
  }>
) => {
  const context = getContextFromReq(req);
  const holdouts = await context.models.holdout.getAll();
  const experiments = await getAllExperiments(context, {
    type: "holdout",
  });
  return res.status(200).json({ status: 200, holdouts, experiments });
};

// endregion GET /holdouts

// region PUT /holdout/:id

export const updateHoldout = async (
  req: AuthRequest<Partial<HoldoutInterface>, { id: string }>,
  res: Response<{ status: 200 | 404; holdout?: HoldoutInterface }>
) => {
  const context = getContextFromReq(req);
  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404 });
  }

  const experiment = await getExperimentById(context, holdout.experimentId);

  if (!experiment) {
    return res.status(404).json({ status: 404 });
  }

  const updatedHoldout = await context.models.holdout.update(holdout, req.body);
  return res.status(200).json({ status: 200, holdout: updatedHoldout });
};

// endregion PUT /holdout/:id

// region POST /holdout/:id/start-analysis

export const startAnalysis = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 | 404 }>
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  if (!holdout) {
    return res.status(404).json({ status: 404 });
  }

  const experiment = await getExperimentById(context, holdout.experimentId);

  if (!experiment) {
    return res.status(404).json({ status: 404 });
  }
  // this deletes the old analysis phase and create a new one when ever the user ends the analysis
  const currentPhase = experiment.phases[0];

  const phases = [
    experiment.phases[0],
    {
      ...currentPhase,
      lookbackStartDate: new Date(),
      name: "Analysis Period",
    },
  ];

  await updateExperiment({
    context,
    experiment,
    changes: {
      phases,
    },
  });
  await context.models.holdout.update(holdout, {
    analysisStartDate: new Date(),
  });

  return res.status(200).json({ status: 200 });
};

// endregion POST /holdout/:id/start-analysis

// region DELETE /holdout/:id

export const deleteHoldout = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 | 404 | 403; message?: string }>
) => {
  const context = getContextFromReq(req);

  const holdout = await context.models.holdout.getById(req.params.id);

  // TODO: Add holdout permissions check

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

  // TODO: Replace with holdout permissions check since it's a multi-project resource
  if (!context.permissions.canDeleteExperiment(experiment)) {
    context.permissions.throwPermissionError();
  }

  await deleteExperimentByIdForOrganization(context, experiment);

  // Remove holdout from linked features and linked experiments
  const linkedFeatureIds = Object.keys(holdout.linkedFeatures);
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);
  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);
  const linkedExperiments = await getExperimentsByIds(
    context,
    linkedExperimentIds
  );

  // Remove holdout links from linked features and experiments
  await Promise.all(
    linkedFeatures.map((f) => updateFeature(context, f, { holdout: undefined }))
  );
  await Promise.all(
    linkedExperiments.map((e) =>
      updateExperiment({
        context,
        experiment: e,
        changes: { holdoutId: undefined },
      })
    )
  );

  await context.models.holdout.delete(holdout);

  return res.status(200).json({ status: 200 });
};

// endregion DELETE /holdout/:id
