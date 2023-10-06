import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { EventAuditUserForResponseLocals } from "../../events/event-types";
import { FeatureReviewRequest } from "../../../types/feature-review";
import {
  approveReviewAsUser,
  createFeatureReviewRequest,
  deleteFeatureReviewRequest,
  getFeatureReviewRequest,
  getFeatureReviewRequests,
  rejectReviewAsUser,
  updateFeatureReviewRequest,
} from "../../models/FeatureReviewModel";
import { getFeature } from "../../models/FeatureModel";

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
  // todo: verify enterprise plan

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
  success: boolean;
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
  // todo: verify enterprise plan

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

  return res.json({
    success: true,
  });
};

type ApproveFeatureReviewRequest = AuthRequest<
  {
    feature: string;
    type: "approved" | "rejected";
    comments?: string;
  },
  {
    id: string;
  },
  Record<string, never>
>;

type ApproveFeatureReviewResponse = {
  success: boolean;
};

export const answerFeatureReview = async (
  req: ApproveFeatureReviewRequest,
  res: Response<
    ApproveFeatureReviewResponse | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  const { org, userId } = getOrgFromReq(req);

  // todo: verify enterprise plan
  const { id } = req.params;
  const { feature: featureId, type, comments = "" } = req.body;
  const feature = await getFeature(org.id, featureId);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  // Verify approving user has permissions to publish this feature
  req.checkPermissions(
    "publishFeatures",
    feature.project,
    (org.settings?.environments || []).map((e) => e.id)
  );

  switch (type) {
    case "approved":
      await approveReviewAsUser({
        userId,
        featureReviewRequestId: id,
        organizationId: org.id,
      });
      break;
    case "rejected":
      await rejectReviewAsUser({
        userId,
        featureReviewRequestId: id,
        organizationId: org.id,
        comments,
      });
      break;
    default:
      throw new Error(`Unsupported answer type ${type}`);
  }

  return res.json({
    success: true,
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
