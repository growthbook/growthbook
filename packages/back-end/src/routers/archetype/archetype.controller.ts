import type { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse, PrivateApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import {
  ArchetypeAttributeValues,
  ArchetypeInterface,
} from "../../../types/archetype";
import {
  createArchetype,
  deleteArchetypeById,
  getAllArchetype,
  getArchetypeById,
  updateArchetypeById,
} from "../../models/ArchetypeModel";
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

type GetArchetypeResponse = {
  status: 200;
  Archetype: ArchetypeInterface[];
};

/**
 * GET /sample-users
 * Create a sample user
 * @param req
 * @param res
 */
export const getArchetype = async (
  req: AuthRequest,
  res: Response<GetArchetypeResponse>
) => {
  const { org, userId } = getOrgFromReq(req);

  req.checkPermissions("manageArchetype");

  const Archetype = await getAllArchetype(org.id, userId);

  return res.status(200).json({
    status: 200,
    Archetype,
  });
};

// endregion GET /sample-users

// region GET /sample-users/eval/:id

type GetArchetypeAndEvalResponse = {
  status: 200;
  Archetype: ArchetypeInterface[];
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
export const getArchetypeAndEval = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<GetArchetypeAndEvalResponse | PrivateApiErrorResponse>
) => {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Feature not found");
  }

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  req.checkPermissions("manageArchetype");

  const Archetype = await getAllArchetype(org.id, userId);
  const featureResults: { [key: string]: FeatureTestResult[] } = {};

  if (Archetype.length) {
    const promiseCallbacks: (() => Promise<unknown>)[] = [];
    Archetype.forEach((user) => {
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
    Archetype,
    featureResults,
  });
};
// endregion GET /sample-users/eval/:id

// region POST /sample-users

type CreateArchetypeRequest = AuthRequest<{
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  attributes: ArchetypeAttributeValues;
}>;

type CreateArchetypeResponse = {
  status: 200;
  Archetype: ArchetypeInterface;
};

/**
 * POST /sample-users
 * Create a sample user
 * @param req
 * @param res
 */
export const postArchetype = async (
  req: CreateArchetypeRequest,
  res: Response<CreateArchetypeResponse | PrivateApiErrorResponse>
) => {
  const { org, userId } = getOrgFromReq(req);
  const { name, attributes, description, isPublic } = req.body;

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  req.checkPermissions("manageArchetype");

  const Archetype = await createArchetype({
    attributes,
    name,
    description,
    owner: userId,
    isPublic,
    organization: org.id,
  });

  await req.audit({
    event: "Archetype.created",
    entity: {
      object: "Archetype",
      id: Archetype.id,
      name,
    },
    details: auditDetailsCreate(Archetype),
  });

  return res.status(200).json({
    status: 200,
    Archetype,
  });
};

// endregion POST /sample-users

// region PUT /sample-users/:id

type PutArchetypeRequest = AuthRequest<
  {
    name: string;
    description: string;
    owner: string;
    attributes: Record<string, string | boolean | number | object>;
    isPublic: boolean;
  },
  { id: string }
>;

type PutArchetypeResponse = {
  status: 200;
};

/**
 * PUT /sample-users/:id
 * Update one sample user
 * @param req
 * @param res
 */
export const putArchetype = async (
  req: PutArchetypeRequest,
  res: Response<
    PutArchetypeResponse | ApiErrorResponse | PrivateApiErrorResponse
  >
) => {
  const { org } = getOrgFromReq(req);
  const { name, description, isPublic, owner, attributes } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify sample user id");
  }

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  req.checkPermissions("manageArchetype");

  const Archetype = await getArchetypeById(id, org.id);

  if (!Archetype) {
    throw new Error("Could not find sample user");
  }

  const changes = await updateArchetypeById(id, org.id, {
    attributes,
    name,
    description,
    isPublic,
    owner,
  });

  const updatedArchetype = { ...Archetype, ...changes };

  await req.audit({
    event: "Archetype.updated",
    entity: {
      object: "Archetype",
      id: updatedArchetype.id,
      name: name,
    },
    details: auditDetailsUpdate(Archetype, updatedArchetype),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion PUT /sample-users/:id

// region DELETE /sample-users/:id

type DeleteArchetypeRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteArchetypeResponse =
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
export const deleteArchetype = async (
  req: DeleteArchetypeRequest,
  res: Response<DeleteArchetypeResponse>
) => {
  req.checkPermissions("manageArchetype");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const Archetype = await getArchetypeById(id, org.id);

  if (!Archetype) {
    res.status(403).json({
      status: 404,
      message: "Sample user not found",
    });
    return;
  }

  if (Archetype.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this sample user",
    });
    return;
  }

  await deleteArchetypeById(id, org.id);

  await req.audit({
    event: "Archetype.deleted",
    entity: {
      object: "Archetype",
      id: id,
      name: Archetype.name,
    },
    details: auditDetailsDelete(Archetype),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /sample-users/:id
