import type { Response } from "express";
import uniqid from "uniqid";
import { FilterQuery } from "mongoose";
import { AuthRequest } from "@back-end/src/types/AuthRequest";
import { getContextFromReq } from "@back-end/src/services/organizations";
import { getIdeasByQuery } from "@back-end/src/services/ideas";
import { ApiErrorResponse } from "@back-end/types/api";
import {
  createSegment,
  deleteSegmentById,
  findSegmentById,
  findSegmentsByOrganization,
  updateSegment,
} from "@back-end/src/models/SegmentModel";
import { getDataSourceById } from "@back-end/src/models/DataSourceModel";
import { IdeaDocument, IdeaModel } from "@back-end/src/models/IdeasModel";
import {
  getMetricsUsingSegment,
  removeSegmentFromAllMetrics,
} from "@back-end/src/models/MetricModel";
import {
  deleteExperimentSegment,
  getExperimentsUsingSegment,
} from "@back-end/src/models/ExperimentModel";
import { MetricInterface } from "@back-end/types/metric";
import { SegmentInterface } from "@back-end/types/segment";
import { ExperimentInterface } from "@back-end/types/experiment";
import { EventAuditUserForResponseLocals } from "@back-end/src/events/event-types";

// region GET /segments

type GetSegmentsRequest = AuthRequest;

type GetSegmentsResponse = {
  status: 200;
  segments: SegmentInterface[];
};

/**
 * GET /segments
 * Get all segment resources
 * @param req
 * @param res
 */
export const getSegments = async (
  req: GetSegmentsRequest,
  res: Response<GetSegmentsResponse, EventAuditUserForResponseLocals>
) => {
  const { org } = getContextFromReq(req);
  const segments = await findSegmentsByOrganization(org.id);
  res.status(200).json({
    status: 200,
    segments,
  });
};

// endregion GET /segments

// region GET /segments/:id/usage

type GetSegmentUsageRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type GetSegmentUsageResponse = {
  ideas: IdeaDocument[];
  metrics: MetricInterface[];
  experiments: ExperimentInterface[];
  total: number;
  status: 200;
};

/**
 * GET /segments/:id/usage
 * Get segment usage data by segment ID
 * @param req
 * @param res
 */
export const getSegmentUsage = async (
  req: GetSegmentUsageRequest,
  res: Response<GetSegmentUsageResponse, EventAuditUserForResponseLocals>
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const segment = await findSegmentById(id, org.id);

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
  const metrics = await getMetricsUsingSegment(context, id);

  // experiments:
  const experiments = await getExperimentsUsingSegment(context, id);

  res.status(200).json({
    ideas,
    metrics,
    experiments,
    total: ideas.length + metrics.length + experiments.length,
    status: 200,
  });
};

// endregion GET /segments/:id

// region POST /segments

type CreateSegmentRequest = AuthRequest<{
  datasource: string;
  userIdType: string;
  name: string;
  sql: string;
  description: string;
}>;

type CreateSegmentResponse = {
  status: 200;
  segment: SegmentInterface;
};

/**
 * POST /segments
 * Create a segment resource
 * @param req
 * @param res
 */
export const postSegment = async (
  req: CreateSegmentRequest,
  res: Response<
    CreateSegmentResponse | ApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("createSegments");

  const { datasource, name, sql, userIdType, description } = req.body;

  const context = getContextFromReq(req);
  const { org, userName } = context;

  const datasourceDoc = await getDataSourceById(context, datasource);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const doc = await createSegment({
    owner: userName,
    datasource,
    userIdType,
    name,
    sql,
    id: uniqid("seg_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    description,
  });

  res.status(200).json({
    status: 200,
    segment: doc,
  });
};

// endregion POST /segments

// region PUT /segments/:id

type PutSegmentRequest = AuthRequest<
  {
    datasource: string;
    userIdType: string;
    name: string;
    sql: string;
    owner: string;
    description: string;
  },
  { id: string }
>;

type PutSegmentResponse = {
  status: 200;
};

/**
 * PUT /segments/:id
 * Update one segment resource
 * @param req
 * @param res
 */
export const putSegment = async (
  req: PutSegmentRequest,
  res: Response<
    PutSegmentResponse | ApiErrorResponse,
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("createSegments");

  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const segment = await findSegmentById(id, org.id);

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (segment.organization !== org.id) {
    throw new Error("You don't have access to that segment");
  }

  const { datasource, name, sql, userIdType, owner, description } = req.body;

  const datasourceDoc = await getDataSourceById(context, datasource);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  await updateSegment(id, org.id, {
    datasource,
    userIdType,
    name,
    owner,
    sql,
    dateUpdated: new Date(),
    description,
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion PUT /segments/:id

// region DELETE /segments/:id

type DeleteSegmentRequest = AuthRequest<null, { id: string }>;

type DeleteSegmentResponse = {
  status: 200;
};

/**
 * DELETE /segments/:id
 * Delete one segment resource by ID
 * @param req
 * @param res
 */
export const deleteSegment = async (
  req: DeleteSegmentRequest,
  res: Response<DeleteSegmentResponse, EventAuditUserForResponseLocals>
) => {
  req.checkPermissions("createSegments");

  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;
  const segment = await findSegmentById(id, org.id);

  if (!segment) {
    throw new Error("Could not find segment");
  }

  await deleteSegmentById(id, org.id);

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
  await removeSegmentFromAllMetrics(org.id, id);

  await deleteExperimentSegment(context, id);

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /segments/:id
