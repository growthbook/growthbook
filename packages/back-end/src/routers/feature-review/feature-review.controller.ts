import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { FeatureReviewRequest } from "../../../types/feature-review";
import {
  createFeatureReviewRequest,
  deleteFeatureReviewRequest,
  getFeatureReviewRequest,
  getFeatureReviewRequests,
  updateFeatureReviewRequest,
} from "../../models/FeatureReviewModel";

// region GET /feature-review

type GetFeatureReviewsRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  { feature: string }
>;

type GetFeatureReviewsResponse = {
  featureReviewRequests: FeatureReviewRequest[];
};

/**
 * GET /feature-review
 * Get all feature-review resources
 * @param req
 * @param res
 */
export const getFeatureReviews = async (
  req: GetFeatureReviewsRequest,
  res: Response<
    GetFeatureReviewsResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { org } = getOrgFromReq(req);
  const featureId = req.query.feature;

  const featureReviewRequests = await getFeatureReviewRequests({
    organizationId: org.id,
    featureId,
  });

  return res.json({
    featureReviewRequests,
  });
};

// endregion GET /feature-review

// region GET /feature-review/:id

type GetFeatureReviewRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type GetFeatureReviewResponse = {
  featureReviewRequest: FeatureReviewRequest;
};

/**
 * GET /feature-review/:id
 * Get one feature-review resource by ID
 * @param req
 * @param res
 */
export const getFeatureReview = async (
  req: GetFeatureReviewRequest,
  res: Response<
    GetFeatureReviewResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { org } = getOrgFromReq(req);
  const id = req.params.id;

  const featureReviewRequest = await getFeatureReviewRequest({
    id,
    organizationId: org.id,
  });

  if (!featureReviewRequest) {
    throw new Error(`Feature review request ${id} not found`);
  }

  return res.json({
    featureReviewRequest,
  });
};

// endregion GET /feature-review/:id

// region POST /feature-review

type CreateFeatureReviewRequest = AuthRequest<
  {
    featureId: string;
    featureRevisionId: string;
    description: string;
    requestedUserIds: string[];
  },
  Record<string, never>,
  Record<string, never>
>;

type CreateFeatureReviewResponse = {
  featureReviewRequest: FeatureReviewRequest;
};

/**
 * POST /feature-review
 * Create a feature-review resource
 * @param req
 * @param res
 */
export const postFeatureReview = async (
  req: CreateFeatureReviewRequest,
  res: Response<
    CreateFeatureReviewResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const {
    featureId,
    featureRevisionId,
    description,
    requestedUserIds,
  } = req.body;
  const { org, userId } = getOrgFromReq(req);

  const featureReviewRequest = await createFeatureReviewRequest({
    organizationId: org.id,
    featureId,
    featureRevisionId,
    description,
    requestedUserIds,
    userId,
  });

  return res.json({
    featureReviewRequest,
  });
};

// endregion POST /feature-review

// region PUT /feature-review/:id

// todo: /feature-review/review

type PatchFeatureReviewRequest = AuthRequest<
  {
    addReviewers: string[];
    removeReviewers: string[];
    dismissReviewers: string[];
    description: string;
  },
  { id: string },
  Record<string, never>
>;

type PatchFeatureReviewResponse = {
  featureReview: unknown;
};

/**
 * PATCH /feature-review/:id
 * Update select properties of a feature review request
 * @param req
 * @param res
 */
export const patchFeatureReview = async (
  req: PatchFeatureReviewRequest,
  res: Response<
    PatchFeatureReviewResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { org } = getOrgFromReq(req);
  const id = req.params.id;

  const {
    addReviewers,
    removeReviewers,
    description,
    dismissReviewers,
  } = req.body;

  await updateFeatureReviewRequest({
    description,
    featureReviewRequestId: id,
    organizationId: org.id,
    addReviewers,
    removeReviewers,
    dismissReviewers,
  });
};

// endregion PUT /feature-review/:id

// region DELETE /feature-review/:id

type DeleteFeatureReviewRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteFeatureReviewResponse = {
  deleted: boolean;
};

/**
 * DELETE /feature-review/:id
 * Delete one feature-review resource by ID
 * @param req
 * @param res
 */
export const deleteFeatureReview = async (
  req: DeleteFeatureReviewRequest,
  res: Response<
    DeleteFeatureReviewResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { id } = req.params;
  const { org, userId } = getOrgFromReq(req);

  const success = await deleteFeatureReviewRequest({
    userId,
    organizationId: org.id,
    featureReviewRequestId: id,
  });

  if (!success) {
    return res.status(400).json({
      deleted: false,
    });
  }

  return res.json({ deleted: true });
};

// endregion DELETE /feature-review/:id
