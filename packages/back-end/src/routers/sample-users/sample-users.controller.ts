import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import {
  SampleUserAttributeValues,
  SampleUsersInterface,
} from "../../../types/sample-users";
import {
  createSampleUser,
  deleteSampleUserById,
  getAllSampleUsers,
  getSampleUserById,
  updateSampleUserById,
} from "../../models/SampleUsersModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import { FeatureTestResult } from "../../../types/feature";
import { evaluateFeature } from "../../services/features";
import { getFeature } from "../../models/FeatureModel";
import { promiseAllChunks } from "../../util/promise";

// region GET /sample-users

type GetSampleUsersResponse = {
  status: 200;
  sampleUsers: SampleUsersInterface[];
};

/**
 * GET /sample-users
 * Create a sample user
 * @param req
 * @param res
 */
export const getSampleUsers = async (
  req: AuthRequest,
  res: Response<GetSampleUsersResponse>
) => {
  const { org, userId } = getOrgFromReq(req);

  req.checkPermissions("manageSampleUsers");

  const sampleUsers = await getAllSampleUsers(org.id, userId);

  return res.status(200).json({
    status: 200,
    sampleUsers,
  });
};

// endregion GET /sample-users

// region GET /sample-users/eval/:id

type GetSampleUsersAndEvalResponse = {
  status: 200;
  sampleUsers: SampleUsersInterface[];
  featureResults:
    | { [key: string]: FeatureTestResult[] }
    | Record<string, never>;
};

/**
 * GET /sample-users/eval/:id
 * Get sample users and eval for a given feature
 * @param req
 * @param res
 */
export const getSampleUsersAndEval = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<GetSampleUsersAndEvalResponse>
) => {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Feature not found");
  }

  req.checkPermissions("manageSampleUsers");

  const sampleUsers = await getAllSampleUsers(org.id, userId);
  const featureResults: { [key: string]: FeatureTestResult[] } = {};

  if (sampleUsers.length) {
    const promiseCallbacks: (() => Promise<unknown>)[] = [];
    sampleUsers.forEach((user) => {
      promiseCallbacks.push(async () => {
        const result = await evaluateFeature(feature, user.attributes, org);
        if (!result) return;
        featureResults[user.id] = await evaluateFeature(
          feature,
          user.attributes,
          org
        );
      });
    });
    await promiseAllChunks(promiseCallbacks, 5);
  }

  return res.status(200).json({
    status: 200,
    sampleUsers,
    featureResults,
  });
};
// endregion GET /sample-users/eval/:id

// region POST /sample-users

type CreateSampleUsersRequest = AuthRequest<{
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  attributes: SampleUserAttributeValues;
}>;

type CreateSampleUsersResponse = {
  status: 200;
  sampleUser: SampleUsersInterface;
};

/**
 * POST /sample-users
 * Create a sample user
 * @param req
 * @param res
 */
export const postSampleUsers = async (
  req: CreateSampleUsersRequest,
  res: Response<CreateSampleUsersResponse>
) => {
  const { org, userId } = getOrgFromReq(req);
  const { name, attributes, description, isPublic } = req.body;

  req.checkPermissions("manageSampleUsers");

  const sampleUser = await createSampleUser({
    attributes,
    name,
    description,
    owner: userId,
    isPublic,
    organization: org.id,
  });

  await req.audit({
    event: "sampleUsers.created",
    entity: {
      object: "sampleUser",
      id: sampleUser.id,
      name,
    },
    details: auditDetailsCreate(sampleUser),
  });

  return res.status(200).json({
    status: 200,
    sampleUser,
  });
};

// endregion POST /sample-users

// region PUT /sample-users/:id

type PutSampleUsersRequest = AuthRequest<
  {
    name: string;
    description: string;
    owner: string;
    attributes: Record<string, string | boolean | number | object>;
    isPublic: boolean;
  },
  { id: string }
>;

type PutSampleUsersResponse = {
  status: 200;
};

/**
 * PUT /sample-users/:id
 * Update one sample user
 * @param req
 * @param res
 */
export const putSampleUser = async (
  req: PutSampleUsersRequest,
  res: Response<PutSampleUsersResponse | ApiErrorResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { name, description, isPublic, owner, attributes } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify sample user id");
  }

  req.checkPermissions("manageSampleUsers");

  const sampleUser = await getSampleUserById(id, org.id);

  if (!sampleUser) {
    throw new Error("Could not find sample user");
  }

  const changes = await updateSampleUserById(id, org.id, {
    attributes,
    name,
    description,
    isPublic,
    owner,
  });

  const updatedSampleUser = { ...sampleUser, ...changes };

  await req.audit({
    event: "sampleUsers.updated",
    entity: {
      object: "sampleUser",
      id: updatedSampleUser.id,
      name: name,
    },
    details: auditDetailsUpdate(sampleUser, updatedSampleUser),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion PUT /sample-users/:id

// region DELETE /sample-users/:id

type DeleteSampleUsersRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteSampleUsersResponse =
  | {
      status: 200;
    }
  | {
      status: number;
      message: string;
    };

/**
 * DELETE /sample-users/:id
 * Delete one sample-users resource by ID
 * @param req
 * @param res
 */
export const deleteSampleUsers = async (
  req: DeleteSampleUsersRequest,
  res: Response<DeleteSampleUsersResponse>
) => {
  req.checkPermissions("manageSampleUsers");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const sampleUser = await getSampleUserById(id, org.id);

  if (!sampleUser) {
    res.status(403).json({
      status: 404,
      message: "Sample user not found",
    });
    return;
  }

  if (sampleUser.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this sample user",
    });
    return;
  }

  await deleteSampleUserById(id, org.id);

  await req.audit({
    event: "sampleUsers.deleted",
    entity: {
      object: "sampleUser",
      id: id,
      name: sampleUser.name,
    },
    details: auditDetailsDelete(sampleUser),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /sample-users/:id
