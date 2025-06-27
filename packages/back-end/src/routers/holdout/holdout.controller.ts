// region GET /holdout/:id

import type { Response } from "express";
import { getAffectedEnvsForExperiment } from "shared/util";
import {
  ExperimentInterface,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
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
    linkedFeatures?: LinkedFeatureInfo[];
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

  const linkedFeatureInfo = await getLinkedFeatureInfo(
    context,
    holdoutExperiment
  );

  const linkedFeatureIds = holdoutExperiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment: holdoutExperiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  res.status(200).json({
    status: 200,
    holdout,
    experiment: holdoutExperiment,
    linkedFeatures: linkedFeatureInfo,
    envs,
  });
};

// endregion GET /holdout/:id
