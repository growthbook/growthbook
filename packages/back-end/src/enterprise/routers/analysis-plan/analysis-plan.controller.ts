import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  AnalysisPlanInterface,
  CreateAnalysisPlanProps,
  UpdateAnalysisPlanProps,
} from "./analysis-plan.validators";

/**
 * GET /analysis-plans
 * Get all analysis plans for the organization
 * @param req
 * @param res
 */
export const getAnalysisPlans = async (
  req: AuthRequest,
  res: Response<{ status: 200; analysisPlans: AnalysisPlanInterface[] }>
) => {
  const context = getContextFromReq(req);

  // Get all analysis plans
  const analysisPlans = await context.models.analysisPlans.getAll();

  res.status(200).json({
    status: 200,
    analysisPlans,
  });
};

/**
 * GET /analysis-plans/:id
 * Get a specific analysis plan by ID
 * @param req
 * @param res
 */
export const getAnalysisPlanById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; analysisPlan: AnalysisPlanInterface }>
) => {
  const context = getContextFromReq(req);

  const analysisPlan = await context.models.analysisPlans.getById(
    req.params.id
  );

  if (!analysisPlan) {
    throw new Error("Could not find analysis plan with that id");
  }

  res.status(200).json({
    status: 200,
    analysisPlan,
  });
};

/**
 * POST /analysis-plans
 * Create a new analysis plan
 * @param req
 * @param res
 */
export const postAnalysisPlan = async (
  req: AuthRequest<CreateAnalysisPlanProps>,
  res: Response<{ status: 200; analysisPlan: AnalysisPlanInterface }>
) => {
  const context = getContextFromReq(req);
  const data = req.body;

  // Create the analysis plan
  const analysisPlan = await context.models.analysisPlans.create({
    project: data.project || "",
    name: data.name,
    description: data.description || "",
    rules: data.rules,
    owner: context.userId,
  });

  res.status(200).json({
    status: 200,
    analysisPlan,
  });
};

/**
 * DELETE /analysis-plans/:id
 * Delete an analysis plan
 * @param req
 * @param res
 */
export const deleteAnalysisPlan = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const context = getContextFromReq(req);

  const analysisPlan = await context.models.analysisPlans.getById(
    req.params.id
  );

  if (!analysisPlan) {
    throw new Error("Could not find analysis plan with that id");
  }

  await context.models.analysisPlans.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};

/**
 * PUT /analysis-plans/:id
 * Update an analysis plan
 * @param req
 * @param res
 */
export const putAnalysisPlan = async (
  req: AuthRequest<UpdateAnalysisPlanProps, { id: string }>,
  res: Response<{ status: 200; analysisPlan: AnalysisPlanInterface }>
) => {
  const context = getContextFromReq(req);
  const updates = req.body;

  const existingAnalysisPlan = await context.models.analysisPlans.getById(
    req.params.id
  );

  if (!existingAnalysisPlan) {
    throw new Error("Could not find analysis plan with that id");
  }

  // Update the analysis plan
  const updatedAnalysisPlan = await context.models.analysisPlans.updateById(
    req.params.id,
    updates
  );

  res.status(200).json({
    status: 200,
    analysisPlan: updatedAnalysisPlan,
  });
};
