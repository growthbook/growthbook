import type { Response } from "express";
import uniqid from "uniqid";
import { FilterQuery } from "mongoose";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";
import {
  createSegment,
  deleteSegmentById,
  findSegmentById,
  findSegmentsByOrganization,
  updateSegment,
} from "../../models/SegmentModel";
import { getDataSourceById } from "../../models/DataSourceModel";
import { getIdeasByQuery } from "../../services/ideas";
import { IdeaDocument, IdeaModel } from "../../models/IdeasModel";
import {
  getMetricsUsingSegment,
  removeSegmentFromAllMetrics,
} from "../../models/MetricModel";
import {
  deleteExperimentSegment,
  getExperimentsUsingSegment,
} from "../../models/ExperimentModel";
import { MetricInterface } from "../../../types/metric";
import { SegmentInterface } from "../../../types/segment";
import { ExperimentInterface } from "../../../types/experiment";
import { EventAuditUserForResponseLocals } from "../../events/event-types";

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
  res: Response<GetSegmentsResponse, EventAuditUserForResponseLocals>,
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
  res: Response<GetSegmentUsageResponse, EventAuditUserForResponseLocals>,
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
  >,
) => {
  const { datasource, name, sql, userIdType, description } = req.body;

  const context = getContextFromReq(req);
  if (!context.permissions.canCreateSegment()) {
    context.permissions.throwPermissionError();
  }
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
  >,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  if (!context.permissions.canUpdateSegment()) {
    context.permissions.throwPermissionError();
  }
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
  res: Response<DeleteSegmentResponse, EventAuditUserForResponseLocals>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteSegment()) {
    context.permissions.throwPermissionError();
  }

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
      },
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
