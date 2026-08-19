import type { Response } from "express";
import isEqual from "lodash/isEqual";
import { omit } from "lodash";
import { UpdateProps } from "shared/types/base-model";
import { CreateHoldoutInput, HoldoutInterface } from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import {
  getEnabledHoldoutEnvironments,
  HoldoutStage,
  PermissionError,
} from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getEnvironments,
} from "back-end/src/services/organizations";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import {
  getAllExperiments,
  getExperimentById,
  getExperimentsByIds,
  hasArchivedExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  setHoldoutStage,
  assertCanUpdateHoldout,
  assertHoldoutScopeCoversLinked,
  createHoldoutWithExperiment,
  deleteHoldoutAndExperiment,
  normalizeHoldoutScheduleUpdates,
} from "back-end/src/services/holdouts";
import {
  assertNoLinkedHoldoutExperiments,
  getFeature,
  getFeaturesByIds,
  removeHoldoutFromFeature,
} from "back-end/src/models/FeatureModel";
import { logger } from "back-end/src/util/logger";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { SoftWarningError } from "back-end/src/util/errors";
import { PrivateApiErrorResponse } from "back-end/types/api";

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
    envs: getEnabledHoldoutEnvironments(holdout.environmentSettings),
  });
};

// endregion GET /holdout/:id

// region POST /holdout

export const createHoldout = async (
  req: AuthRequest<
    CreateHoldoutInput,
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

  const data = req.body;

  if (
    !context.permissions.canCreateHoldout({ projects: data.projects || [] })
  ) {
    context.permissions.throwPermissionError();
  }

  try {
    const { holdout, experiment, datasource, metricIds } =
      await createHoldoutWithExperiment(context, data);

    if (datasource && req.query.autoRefreshResults && metricIds.length > 0) {
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
    if (e instanceof SoftWarningError || e instanceof PermissionError) throw e;
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
  req: AuthRequest<UpdateProps<HoldoutInterface>, { id: string }>,
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

  const updates = { ...req.body };

  if (updates.statusUpdateSchedule !== undefined) {
    const { statusUpdateSchedule, nextScheduledStatusUpdate } =
      normalizeHoldoutScheduleUpdates({
        holdout,
        experiment,
        scheduleInput: updates.statusUpdateSchedule,
      });
    updates.statusUpdateSchedule = statusUpdateSchedule;
    updates.nextScheduledStatusUpdate = nextScheduledStatusUpdate;
  }

  // Shared with the REST update handler. The UI never sends targeting through
  // this path (it lives on the companion experiment), but the gate still takes
  // the flag so both callers stay identical.
  assertCanUpdateHoldout(context, {
    holdout,
    updatedProjects: updates.projects,
    requestedEnabledEnvironments: updates.environmentSettings
      ? getEnabledHoldoutEnvironments(updates.environmentSettings)
      : undefined,
    isTargetingChange: false,
    isScheduleChange: (req.body.statusUpdateSchedule ?? null) !== null,
  });

  // Only when the scope actually changes, so a Holdout already holding a
  // stranded link stays editable to be fixed.
  if (updates.projects && !isEqual(updates.projects, holdout.projects)) {
    await assertHoldoutScopeCoversLinked(context, holdout, updates.projects);
  }

  const updatedHoldout = await context.models.holdout.update(holdout, updates);
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

  let stage: HoldoutStage;
  if (req.body.status === "stopped" || req.body.status === "draft") {
    stage = req.body.status;
  } else if (experiment.status === "draft") {
    stage = "running";
  } else {
    stage = req.body.holdoutRunningStatus ?? "running";
  }

  // Starting the holdout (draft -> running) publishes to its enabled
  // environments, so it needs run permission, mirroring the REST start path.
  if (stage === "running" && experiment.status === "draft") {
    const enabledEnvs = getEnabledHoldoutEnvironments(
      holdout.environmentSettings,
    );
    if (
      enabledEnvs.length > 0 &&
      !context.permissions.canRunHoldout(holdout, enabledEnvs)
    ) {
      context.permissions.throwPermissionError();
    }
  }

  await setHoldoutStage(context, { holdout, experiment, stage });

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

  await deleteHoldoutAndExperiment(context, holdout, experiment);

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

  // Stripping the holdout changes what the live flag serves, so it takes
  // publish authority over the environments it serves in — not draft authority.
  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(
        getEnabledEnvironments(
          feature,
          // The flag's APPLICABLE environments, not every org environment: an
          // org environment excluded from the flag's project isn't one this
          // change serves, and demanding authority there produced false 403s.
          getApplicableEnvIds(getEnvironments(context.org), feature),
        ),
      ),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // Same invariant as the revision-based removal path: don't strip the holdout
  // off a feature while a linked experiment still belongs to it, or the
  // experiment would be left held-out with no feature gating it. Detach the
  // experiment (remove its rule, or remove it from the holdout) first.
  await assertNoLinkedHoldoutExperiments(context, holdout.id, feature.rules);

  await removeHoldoutFromFeature(context, feature);

  await context.models.holdout.update(holdout, {
    linkedFeatures: omit(holdout.linkedFeatures, feature.id),
  });

  return res.status(200).json({ status: 200 });
};

// endregion DELETE /holdout/:id/feature/:featureId
