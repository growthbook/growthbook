import { Response } from "express";
import {
  DecisionCriteriaInterface,
  CreateDecisionCriteriaProps,
  UpdateDecisionCriteriaProps,
} from "shared/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

/**
 * GET /decision-criteria
 * Get all decision criteria for the organization
 * @param req
 * @param res
 */
export const getDecisionCriteria = async (
  req: AuthRequest,
  res: Response<{ status: 200; decisionCriteria: DecisionCriteriaInterface[] }>,
) => {
  const context = getContextFromReq(req);

  // Get all decision criteria
  const decisionCriteria = await context.models.decisionCriteria.getAll();

  res.status(200).json({
    status: 200,
    decisionCriteria,
  });
};

/**
 * GET /decision-criteria/:id
 * Get a specific decision criteria by ID
 * @param req
 * @param res
 */
export const getDecisionCriteriaById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<
    | { status: 200; decisionCriteria: DecisionCriteriaInterface }
    | { status: 400; error: string }
  >,
) => {
  const context = getContextFromReq(req);

  const decisionCriteria = await context.models.decisionCriteria.getById(
    req.params.id,
  );

  if (!decisionCriteria) {
    throw new Error("Could not find decision criteria with that id");
  }

  res.status(200).json({
    status: 200,
    decisionCriteria,
  });
};

/**
 * POST /decision-criteria
 * Create a new decision criteria
 * @param req
 * @param res
 */
export const postDecisionCriteria = async (
  req: AuthRequest<CreateDecisionCriteriaProps>,
  res: Response<{ status: 200; decisionCriteria: DecisionCriteriaInterface }>,
) => {
  const context = getContextFromReq(req);
  const data = req.body;

  // Create the decision criteria
  const decisionCriteria = await context.models.decisionCriteria.create({
    project: data.project,
    name: data.name,
    description: data.description,
    rules: data.rules,
    defaultAction: data.defaultAction,
    owner: context.userId,
  });

  res.status(200).json({
    status: 200,
    decisionCriteria,
  });
};

/**
 * DELETE /decision-criteria/:id
 * Delete a decision criteria
 * @param req
 * @param res
 */
export const deleteDecisionCriteria = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);

  const decisionCriteria = await context.models.decisionCriteria.getById(
    req.params.id,
  );

  if (!decisionCriteria) {
    throw new Error("Could not find decision criteria with that id");
  }

  await context.models.decisionCriteria.deleteById(req.params.id);

  res.status(200).json({
    status: 200,
  });
};

/**
 * PUT /decision-criteria/:id
 * Update a decision criteria
 * @param req
 * @param res
 */
export const putDecisionCriteria = async (
  req: AuthRequest<UpdateDecisionCriteriaProps, { id: string }>,
  res: Response<{ status: 200; decisionCriteria: DecisionCriteriaInterface }>,
) => {
  const context = getContextFromReq(req);
  const updates = req.body;

  const existingDecisionCriteria =
    await context.models.decisionCriteria.getById(req.params.id);

  if (!existingDecisionCriteria) {
    throw new Error("Could not find decision criteria with that id");
  }

  // Update the decision criteria
  const updatedDecisionCriteria =
    await context.models.decisionCriteria.updateById(req.params.id, updates);

  res.status(200).json({
    status: 200,
    decisionCriteria: updatedDecisionCriteria,
  });
};
