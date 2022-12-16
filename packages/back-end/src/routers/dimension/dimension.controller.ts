import type { Response } from "express";
import uniqid from "uniqid";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { DimensionInterface } from "../../../types/dimension";
import {
  createDimension,
  deleteDimensionById,
  findDimensionById,
  findDimensionsByOrganization,
  updateDimension,
} from "../../models/DimensionModel";
import { getDataSourceById } from "../../models/DataSourceModel";

// region GET /dimensions

type GetDimensionsRequest = AuthRequest;

type GetDimensionsResponse = {
  status: 200;
  dimensions: DimensionInterface[];
};

/**
 * GET /dimension
 * Get all dimension resources
 * @param req
 * @param res
 */
export const getDimensions = async (
  req: GetDimensionsRequest,
  res: Response<GetDimensionsResponse | ApiErrorResponse>
) => {
  const { org } = getOrgFromReq(req);
  const dimensions = await findDimensionsByOrganization(org.id);
  res.status(200).json({
    status: 200,
    dimensions,
  });
};

// endregion GET /dimensions

// region POST /dimensions

type CreateDimensionRequest = AuthRequest<{
  datasource: string;
  userIdType: string;
  name: string;
  sql: string;
}>;

type CreateDimensionResponse = {
  status: 200;
  dimension: DimensionInterface;
};

/**
 * POST /dimension
 * Create a dimension resource
 * @param req
 * @param res
 */
export const postDimension = async (
  req: CreateDimensionRequest,
  res: Response<CreateDimensionResponse | ApiErrorResponse>
) => {
  req.checkPermissions("createDimensions");

  const { org, userName } = getOrgFromReq(req);
  const { datasource, name, sql, userIdType } = req.body;

  const datasourceDoc = await getDataSourceById(datasource, org.id);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const doc = await createDimension({
    datasource,
    userIdType,
    owner: userName,
    name,
    sql,
    id: uniqid("dim_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
  });

  res.status(200).json({
    status: 200,
    dimension: doc,
  });
};

// endregion POST /dimensions

// region PUT /dimensions/:id

type PutDimensionRequest = AuthRequest<
  {
    datasource: string;
    userIdType: string;
    name: string;
    sql: string;
    owner: string;
  },
  { id: string },
  Record<string, never>
>;

type PutDimensionResponse = {
  status: 200;
};

/**
 * PUT /dimensions/:id
 * Update one dimension resource
 * @param req
 * @param res
 */
export const putDimension = async (
  req: PutDimensionRequest,
  res: Response<PutDimensionResponse>
) => {
  req.checkPermissions("createDimensions");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const dimension = await findDimensionById(id, org.id);

  if (!dimension) {
    throw new Error("Could not find dimension");
  }

  const { datasource, name, sql, userIdType, owner } = req.body;

  const datasourceDoc = await getDataSourceById(datasource, org.id);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  await updateDimension(id, org.id, {
    datasource,
    userIdType,
    name,
    sql,
    owner,
    dateUpdated: new Date(),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion PUT /dimensions/:id

// region DELETE /dimensions/:id

type DeleteDimensionRequest = AuthRequest<null, { id: string }>;

type DeleteDimensionResponse = {
  status: number;
};

/**
 * DELETE /dimensions/:id
 * Delete one dimension resource by ID
 * @param req
 * @param res
 */
export const deleteDimension = async (
  req: DeleteDimensionRequest,
  res: Response<DeleteDimensionResponse | ApiErrorResponse>
) => {
  req.checkPermissions("createDimensions");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);
  const dimension = await findDimensionById(id, org.id);

  if (!dimension) {
    throw new Error("Could not find dimension");
  }
  try {
    await deleteDimensionById(id, org.id);
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message,
    });
  }

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /dimensions/:id
