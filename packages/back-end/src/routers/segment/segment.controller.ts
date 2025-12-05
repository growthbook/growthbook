import type { Response } from "express";
import { FilterQuery } from "mongoose";
import { z } from "zod";
import { SegmentInterface } from "shared/types/segment";
import {
  createSegmentValidator,
  updateSegmentValidator,
} from "shared/validators";
import { EventUserForResponseLocals } from "back-end/src/events/event-types";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getIdeasByQuery } from "back-end/src/services/ideas";
import { IdeaDocument, IdeaModel } from "back-end/src/models/IdeasModel";
import {
  getMetricsUsingSegment,
  removeSegmentFromAllMetrics,
} from "back-end/src/models/MetricModel";
import {
  deleteExperimentSegment,
  getExperimentsUsingSegment,
} from "back-end/src/models/ExperimentModel";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentInterface } from "back-end/types/experiment";

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
  res: Response<GetSegmentsResponse, EventUserForResponseLocals>,
) => {
  const context = getContextFromReq(req);
  const segments = await context.models.segments.getAll();
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
  res: Response<GetSegmentUsageResponse, EventUserForResponseLocals>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const segment = await context.models.segments.getById(id);

  if (!segment) {
    throw new Error("Could not find segment");
  }
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

type CreateSegmentRequest = AuthRequest<z.infer<typeof createSegmentValidator>>;

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
    EventUserForResponseLocals
  >,
) => {
  const {
    datasource,
    name,
    sql,
    userIdType,
    description,
    owner,
    factTableId,
    filters,
    type,
    projects,
  } = req.body;

  const context = getContextFromReq(req);
  if (!context.permissions.canCreateSegment({ projects })) {
    context.permissions.throwPermissionError();
  }

  const datasourceDoc = await getDataSourceById(context, datasource);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const baseSegment: Omit<
    SegmentInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  > = {
    owner: owner || "",
    datasource,
    userIdType,
    name,
    description,
    type,
    projects,
  };

  if (type === "SQL") {
    // if SQL type, set only sql field
    baseSegment.sql = sql;
  } else {
    // if FACT type, only set factTableId and filters
    baseSegment.factTableId = factTableId;
    baseSegment.filters = filters;
  }

  const doc = await context.models.segments.create(baseSegment);

  res.status(200).json({
    status: 200,
    segment: doc,
  });
};

// endregion POST /segments

// region PUT /segments/:id

type PutSegmentRequest = AuthRequest<
  z.infer<typeof updateSegmentValidator>,
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
    EventUserForResponseLocals
  >,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const segment = await context.models.segments.getById(id);

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (segment.organization !== org.id) {
    throw new Error("You don't have access to that segment");
  }

  const {
    datasource,
    name,
    sql,
    userIdType,
    description,
    owner,
    factTableId,
    filters,
    type,
    projects,
  } = req.body;

  if (!context.permissions.canUpdateSegment(segment, { projects })) {
    context.permissions.throwPermissionError();
  }

  const datasourceDoc = await getDataSourceById(context, datasource);
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  await context.models.segments.updateById(id, {
    owner: owner,
    datasource,
    userIdType,
    name,
    sql,
    description,
    type,
    factTableId,
    filters,
    projects,
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
  res: Response<DeleteSegmentResponse, EventUserForResponseLocals>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const { org } = context;
  const segment = await context.models.segments.getById(id);

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (!context.permissions.canDeleteSegment(segment)) {
    context.permissions.throwPermissionError();
  }

  await context.models.segments.delete(segment);

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
