import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import uniqid from "uniqid";
import { SegmentModel } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import { getOrgFromReq } from "../services/organizations";
import { FilterQuery } from "mongoose";
import { IdeaDocument, IdeaModel } from "../models/IdeasModel";
import { getIdeasByQuery } from "../services/ideas";
import { getExperimentsUsingSegment } from "../services/experiments";
import {
  getMetricsUsingSegment,
  updateMetricsByQuery,
} from "../models/MetricModel";
import { ExperimentModel } from "../models/ExperimentModel";

export async function getAllSegments(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const segments = await SegmentModel.find({
    organization: org.id,
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
  req.checkPermissions("createSegments");

  const { datasource, name, sql, userIdType } = req.body;
  if (!datasource || !sql || !name) {
    throw new Error("Missing required properties");
  }
  const { org, userName } = getOrgFromReq(req);

  const datasourceDoc = await getDataSourceById(datasource, org.id);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const doc = await SegmentModel.create({
    owner: userName,
    datasource,
    userIdType,
    name,
    sql,
    id: uniqid("seg_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
  });

  res.status(200).json({
    status: 200,
    segment: doc,
  });
}
export async function putSegment(
  req: AuthRequest<Partial<SegmentInterface>, { id: string }>,
  res: Response
) {
  req.checkPermissions("createSegments");

  const { id } = req.params;
  const segment = await SegmentModel.findOne({
    id,
  });

  const { org } = getOrgFromReq(req);

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (segment.organization !== org.id) {
    throw new Error("You don't have access to that segment");
  }

  const { datasource, name, sql, userIdType, owner } = req.body;
  if (!datasource || !sql || !name) {
    throw new Error("Missing required properties");
  }

  const datasourceDoc = await getDataSourceById(datasource, org.id);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  segment.set("datasource", datasource);
  segment.set("userIdType", userIdType);
  segment.set("name", name);
  segment.set("owner", owner);
  segment.set("sql", sql);
  segment.set("dateUpdated", new Date());

  await segment.save();

  res.status(200).json({
    status: 200,
    segment,
  });
}

export async function getSegmentUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const segment = await SegmentModel.findOne({
    id,
    organization: org.id,
  });

  if (!segment) {
    throw new Error("Could not find segment");
  }

  // segments are used in a few places:
  // ideas (impact estimate)
  const query: FilterQuery<IdeaDocument> = {
    organization: org.id,
    "estimateParams.segment": id,
  };
  const ideas = await getIdeasByQuery(query);

  // metricSchema
  const metrics = await getMetricsUsingSegment(id, org.id);

  // experiments:
  const experiments = await getExperimentsUsingSegment(id, org.id);

  res.status(200).json({
    ideas,
    metrics,
    experiments,
    total: ideas.length + metrics.length + experiments.length,
    status: 200,
  });
}

export async function deleteSegment(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("createSegments");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);
  const segment = await SegmentModel.findOne({
    id,
    organization: org.id,
  });

  if (!segment) {
    throw new Error("Could not find segment");
  }

  await SegmentModel.deleteOne({
    id,
    organization: org.id,
  });

  // delete references:
  // ideas:
  const ideas = await getIdeasByQuery({
    organization: org.id,
    "estimateParams.segment": id,
  });
  if (ideas.length > 0) {
    await IdeaModel.updateMany(
      { organization: org.id, "estimateParams.segment": id },
      {
        $unset: { "estimateParams.segment": "" },
      }
    );
  }

  // metrics
  const metrics = await getMetricsUsingSegment(id, org.id);
  if (metrics.length > 0) {
    // as update metric query will fail if they are using a config file,
    // we want to allow for deleting if there are no metrics with this segment.
    await updateMetricsByQuery(
      { organization: org.id, segment: id },
      { segment: "" }
    );
  }

  const exps = await getExperimentsUsingSegment(id, org.id);
  if (exps.length > 0) {
    await ExperimentModel.updateMany(
      { organization: org.id, segment: id },
      {
        $set: { segment: "" },
      }
    );
  }

  res.status(200).json({
    status: 200,
  });
}
