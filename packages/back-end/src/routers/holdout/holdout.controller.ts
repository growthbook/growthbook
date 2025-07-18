// region GET /holdout/:id

import type { Response } from "express";
import { ExperimentInterface } from "back-end/types/experiment";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getExperimentById,
  getExperimentsByIds,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { FeatureInterface } from "back-end/types/feature";
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

  const linkedFeatureIds = holdout.linkedFeatures.map((f) => f.id);
  const linkedExperimentIds = holdout.linkedExperiments.map((e) => e.id);

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
    envs: holdout.environments,
  });
};

// endregion GET /holdout/:id

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
