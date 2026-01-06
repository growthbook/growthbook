import type { Response } from "express";
import uniqid from "uniqid";
import { DimensionInterface } from "shared/types/dimension";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { PrivateApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  createDimension,
  deleteDimensionById,
  findDimensionById,
  findDimensionsByOrganization,
  updateDimension,
} from "back-end/src/models/DimensionModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

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
  res: Response<GetDimensionsResponse | PrivateApiErrorResponse>,
) => {
  const { org } = getContextFromReq(req);
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
  description: string;
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
  res: Response<CreateDimensionResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateDimension()) {
    context.permissions.throwPermissionError();
  }
  const { org, userName } = context;
  const { datasource, name, sql, userIdType, description } = req.body;

  const datasourceDoc = await getDataSourceById(context, datasource);
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
    description,
    managedBy: "",
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
    description: string;
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
  res: Response<PutDimensionResponse>,
) => {
  const context = getContextFromReq(req);
  if (!context.permissions.canUpdateDimension()) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;
  const { id } = req.params;
  const dimension = await findDimensionById(id, org.id);

  if (!dimension) {
    throw new Error("Could not find dimension");
  }

  const { datasource, name, sql, userIdType, owner, description } = req.body;

  const datasourceDoc = await getDataSourceById(context, datasource);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  await updateDimension(context, dimension, {
    datasource,
    userIdType,
    name,
    sql,
    owner,
    description,
    managedBy: "",
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
  res: Response<DeleteDimensionResponse | PrivateApiErrorResponse>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  if (!context.permissions.canDeleteDimension()) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;
  const dimension = await findDimensionById(id, org.id);

  if (!dimension) {
    throw new Error("Could not find dimension");
  }
  try {
    await deleteDimensionById(context, dimension);
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
