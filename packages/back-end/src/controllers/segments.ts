import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import uniqid from "uniqid";
import { SegmentModel } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";

export async function getAllSegments(req: AuthRequest, res: Response) {
  const segments = await SegmentModel.find({
    organization: req.organization.id,
  });
  res.status(200).json({
    status: 200,
    segments,
  });
}
export async function postSegments(
  req: AuthRequest<Partial<SegmentInterface>>,
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

  const doc = await SegmentModel.create({
    datasource,
    name,
    sql,
    id: uniqid("seg_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: req.organization.id,
  });

  res.status(200).json({
    status: 200,
    segment: doc,
  });
}
export async function putSegment(
  req: AuthRequest<Partial<SegmentInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const segment = await SegmentModel.findOne({
    id,
  });

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (segment.organization !== req.organization.id) {
    throw new Error("You don't have access to that segment");
  }

  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  segment.set("datasource", datasource);
  segment.set("name", name);
  segment.set("sql", sql);
  segment.set("dateUpdated", new Date());

  await segment.save();

  res.status(200).json({
    status: 200,
    segment,
  });
}
