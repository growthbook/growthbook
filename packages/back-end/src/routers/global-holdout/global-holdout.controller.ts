import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { createExperiment, getExperimentById } from "back-end/src/models/ExperimentModel";
import { GlobalHoldoutInterface } from "back-end/src/validators/global-holdout";
import { ExperimentInterface } from "back-end/src/validators/experiments";

// region GET /global-holdout
/**
 * GET /global-holdout
 * List all global holdouts with their associated experiments
 * @param req
 * @param res
 */
export async function getGlobalHoldouts(
  req: AuthRequest,
  res: Response<{
    status: 200;
    globalHoldouts: Array<GlobalHoldoutInterface & {
      experiment: ExperimentInterface | null;
    }>;
  }>
) {
  const context = getContextFromReq(req);
  const globalHoldouts = await context.models.globalHoldout.getAll();

  // Get associated experiments for each holdout
  const holdoutsWithExperiments = await Promise.all(
    globalHoldouts.map(async (holdout: GlobalHoldoutInterface) => {
      const experiment = await getExperimentById(context, holdout.experimentId);
      return {
        ...holdout,
        experiment,
      };
    })
  );

  res.status(200).json({
    status: 200,
    globalHoldouts: holdoutsWithExperiments,
  });
}
// endregion GET /global-holdout
