import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import uniqid from "uniqid";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  createDimension,
  findDimensionById,
  findDimensionsByOrganization,
  updateDimension,
} from "../models/DimensionModel";
import { DimensionInterface } from "../../types/dimension";

export async function getAllDimensions(req: AuthRequest, res: Response) {
  const dimensions = await findDimensionsByOrganization(req.organization.id);
  res.status(200).json({
    status: 200,
    dimensions,
  });
}
export async function postDimensions(
  req: AuthRequest<Partial<DimensionInterface>>,
  res: Response
) {
  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const doc = await createDimension({
    datasource,
    name,
    sql,
    id: uniqid("dim_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: req.organization.id,
  });

  res.status(200).json({
    status: 200,
    dimension: doc,
  });
}
export async function putDimension(
  req: AuthRequest<Partial<DimensionInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const dimension = await findDimensionById(id, req.organization.id);

  if (!dimension) {
    throw new Error("Could not find dimension");
  }

  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  await updateDimension(id, {
    datasource,
    name,
    sql,
    dateUpdated: new Date(),
  });

  res.status(200).json({
    status: 200,
    dimension,
  });
}
