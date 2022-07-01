import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import uniqid from "uniqid";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  createDimension,
  findDimensionById,
  findDimensionsByOrganization,
  updateDimension,
  deleteDimensionById,
} from "../models/DimensionModel";
import { DimensionInterface } from "../../types/dimension";
import { getOrgFromReq } from "../services/organizations";

export async function getAllDimensions(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const dimensions = await findDimensionsByOrganization(org.id);
  res.status(200).json({
    status: 200,
    dimensions,
  });
}
export async function postDimensions(
  req: AuthRequest<DimensionInterface>,
  res: Response
) {
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
}
export async function putDimension(
  req: AuthRequest<DimensionInterface, { id: string }>,
  res: Response
) {
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
    dimension,
  });
}

export async function deleteDimension(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
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
}
