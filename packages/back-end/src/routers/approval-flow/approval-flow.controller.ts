import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  ApprovalFlowInterface,
  ApprovalEntityType,
  ApprovalFlowCreateInterface,
  ReviewDecision,
} from "shared/validators";
import { ApprovalFlowModel } from "back-end/src/models/ApprovalFlowModel";
import { getMetricById } from "back-end/src/models/MetricModel";
import { getEntityModel } from "back-end/src/enterprise/approval-flows/helpers";

// region GET /approval-flow

type GetAllApprovalFlowsRequest = AuthRequest;

type GetAllApprovalFlowsResponse = {
  status: 200;
  approvalFlows: ApprovalFlowInterface[];
};

/**
 * GET /approval-flow
 * Get all approval flows for the organization
 * @param req
 * @param res
 */
export const getAllApprovalFlows = async (
  req: GetAllApprovalFlowsRequest,
  res: Response<GetAllApprovalFlowsResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getAll();

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};

// endregion GET /approval-flow

// region POST /approval-flow

type CreateApprovalFlowRequest = AuthRequest<{
  entityType: ApprovalEntityType;
  entityId: string;
  title: string;
  description?: string;
  proposedChanges: Record<string, unknown>;
  baseVersion: number;
}>;

type CreateApprovalFlowResponse = {
  status: 200;
  approvalFlow: ApprovalFlowInterface;
};

/**
 * POST /approval-flow
 * Create a new approval flow
 * @param req
 * @param res
 */
export const postApprovalFlow = async (
  req: CreateApprovalFlowRequest,
  res: Response<CreateApprovalFlowResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;

  const {
    entityType,
    entityId,
    title,
    description,
    proposedChanges,
  } = req.body;

  const entityModel = getEntityModel(context, entityType);
  if (!entityModel) {
    throw new Error(`Entity model not found for entity type: ${entityType}`);
  }
  const originalEntity = await entityModel.getById(entityId);
  if (!originalEntity) {
    throw new Error(`Original entity not found for entity type: ${entityType} and entity id: ${entityId}`);
  }

  const approvalFlowModel = new ApprovalFlowModel(context);

  const approvalFlow = await approvalFlowModel.create({
    entity: {
      entityType,
      entityId,
      originalEntity,
      proposedChanges,
    },
    title,
    description: description || "",
    status: "pending-review",
    author: userId,
    reviews: [],
    activityLog: [],
  });

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow

// region GET /approval-flow/entity/:entityType

type GetApprovalFlowsByEntityTypeRequest = AuthRequest<
  never,
  { entityType: ApprovalEntityType }
>;

type GetApprovalFlowsByEntityTypeResponse = {
  status: 200;
  approvalFlows: ApprovalFlowInterface[];
};

/**
 * GET /approval-flow/entity/:entityType
 * Get all approval flows for a specific entity type
 * @param req
 * @param res
 */
export const getApprovalFlowsByEntityType = async (
  req: GetApprovalFlowsByEntityTypeRequest,
  res: Response<GetApprovalFlowsByEntityTypeResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { entityType } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getByEntityType(entityType);

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};
// endregion GET /approval-flow/entity/:entityType

// region GET /approval-flow/entity/:entityType/:entityId

type GetApprovalFlowsByEntityRequest = AuthRequest<
  never,
  { entityType: ApprovalEntityType; entityId: string }
>;

type GetApprovalFlowsByEntityResponse = {
  status: 200;
  approvalFlows: ApprovalFlowInterface[];
};

/**
 * GET /approval-flow/entity/:entityType/:entityId
 * Get all approval flows for a specific entity
 * @param req
 * @param res
 */
export const getApprovalFlowsByEntity = async (
  req: GetApprovalFlowsByEntityRequest,
  res: Response<GetApprovalFlowsByEntityResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlows = await approvalFlowModel.getByEntity(
    entityType,
    entityId
  );

  res.status(200).json({
    status: 200,
    approvalFlows,
  });
};

// endregion GET /approval-flow/entity/:entityType/:entityId

// region GET /approval-flow/:id

type GetApprovalFlowRequest = AuthRequest<never, { id: string }>;

type GetApprovalFlowResponse = {
  status: 200;
  approvalFlow: ApprovalFlowInterface;
};

/**
 * GET /approval-flow/:id
 * Get a specific approval flow by ID
 * @param req
 * @param res
 */
export const getApprovalFlow = async (
  req: GetApprovalFlowRequest,
  res: Response<GetApprovalFlowResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.getById(id);

  if (!approvalFlow) {
    return res.status(404).json({
      message: "Approval flow not found",
    });
  }

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion GET /approval-flow/:id

// region POST /approval-flow/:id/review

type PostReviewRequest = AuthRequest<
  {
    decision: ReviewDecision;
    comment: string;
  },
  { id: string }
>;

type PostReviewResponse = {
  status: 200;
  approvalFlow: ApprovalFlowInterface;
};

/**
 * POST /approval-flow/:id/review
 * Add a review to an approval flow
 * @param req
 * @param res
 */
export const postReview = async (
  req: PostReviewRequest,
  res: Response<PostReviewResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { decision, comment } = req.body;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.addReview(
    id,
    userId,
    decision,
    comment
  );

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/review

// region PUT /approval-flow/:id/proposed-changes

type PutProposedChangesRequest = AuthRequest<
  {
    proposedChanges: Record<string, unknown>;
  },
  { id: string }
>;

type PutProposedChangesResponse = {
  status: 200;
  approvalFlow: ApprovalFlowInterface;
};

/**
 * PUT /approval-flow/:id/proposed-changes
 * Update the proposed changes in an approval flow
 * @param req
 * @param res
 */
export const putProposedChanges = async (
  req: PutProposedChangesRequest,
  res: Response<PutProposedChangesResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { proposedChanges } = req.body;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.updateProposedChanges(
    id,
    proposedChanges,
    userId
  );

  res.status(200).json({
    status: 200,
    approvalFlow,
  });
};

// endregion PUT /approval-flow/:id/proposed-changes

// region POST /approval-flow/:id/merge

type PostMergeRequest = AuthRequest<never, { id: string }>;

type PostMergeResponse = {
  approvalFlow: ApprovalFlowInterface;
};

/**
 * POST /approval-flow/:id/merge
 * Merge an approval flow (apply the changes)
 * @param req
 * @param res
 */
export const postMerge = async (
  req: PostMergeRequest,
  res: Response<PostMergeResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.getById(id);

  if (!approvalFlow) {
    console.log("approval flow not found");
    return res.status(404).json({
      message: "Approval flow not found",
    });
  }
  console.log("approval flow found");
  // Mark the approval flow as merged
  const mergedApprovalFlow = await approvalFlowModel.merge(id, userId);

  res.status(200).json({
    approvalFlow: mergedApprovalFlow,
  });
};

// endregion POST /approval-flow/:id/merge

// region POST /approval-flow/:id/close

type PostCloseRequest = AuthRequest<
  {
    reason?: string;
  },
  { id: string }
>;

type PostCloseResponse = {
  approvalFlow: ApprovalFlowInterface;
};

/**
 * POST /approval-flow/:id/close
 * Close an approval flow without merging
 * @param req
 * @param res
 */
export const postClose = async (
  req: PostCloseRequest,
  res: Response<PostCloseResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;
  const { reason } = req.body;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.close(id, userId, reason);

  res.status(200).json({
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/close

// region POST /approval-flow/:id/reopen

type PostReopenRequest = AuthRequest<never, { id: string }>;

type PostReopenResponse = {
  approvalFlow: ApprovalFlowInterface;
};

/**
 * POST /approval-flow/:id/reopen
 * Reopen a closed approval flow
 * @param req
 * @param res
 */
export const postReopen = async (
  req: PostReopenRequest,
  res: Response<PostReopenResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { id } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const approvalFlow = await approvalFlowModel.reopen(id, userId);

  res.status(200).json({
    approvalFlow,
  });
};

// endregion POST /approval-flow/:id/reopen

// region GET /approval-flow/entity/:entityType/:entityId/history

type GetRevisionHistoryRequest = AuthRequest<
  never,
  { entityType: ApprovalEntityType; entityId: string }
>;

type GetRevisionHistoryResponse = {
  revisions: ApprovalFlowInterface[];
};

/**
 * GET /approval-flow/entity/:entityType/:entityId/history
 * Get revision history (all merged approval flows) for an entity
 * @param req
 * @param res
 */
export const getRevisionHistory = async (
  req: GetRevisionHistoryRequest,
  res: Response<GetRevisionHistoryResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { entityType, entityId } = req.params;

  const approvalFlowModel = new ApprovalFlowModel(context);
  const revisions = await approvalFlowModel.getEntityRevisionHistory(
    entityType,
    entityId
  );

  res.status(200).json({
    revisions,
  });
};

// endregion GET /approval-flow/entity/:entityType/:entityId/history

