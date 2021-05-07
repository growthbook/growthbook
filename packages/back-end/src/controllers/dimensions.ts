import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import uniqid from "uniqid";
import { getDataSourceById } from "../services/datasource";
import { DimensionModel } from "../models/DimensionModel";
import { DimensionInterface } from "../../types/dimension";

export async function getAllDimensions(req: AuthRequest, res: Response) {
  const dimensions = await DimensionModel.find({
    organization: req.organization.id,
  });
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

  const datasourceDoc = await getDataSourceById(datasource);
  if (!datasourceDoc || datasourceDoc.organization !== req.organization.id) {
    throw new Error("Invalid data source");
  }

  const doc = await DimensionModel.create({
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
  const dimension = await DimensionModel.findOne({
    id,
  });

  if (!dimension) {
    throw new Error("Could not find dimension");
  }
  if (dimension.organization !== req.organization.id) {
    throw new Error("You don't have access to that dimension");
  }

  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(datasource);
  if (!datasourceDoc || datasourceDoc.organization !== req.organization.id) {
    throw new Error("Invalid data source");
  }

  dimension.set("datasource", datasource);
  dimension.set("name", name);
  dimension.set("sql", sql);
  dimension.set("dateUpdated", new Date());

  await dimension.save();

  res.status(200).json({
    status: 200,
    dimension,
  });
}
