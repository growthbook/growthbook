/* eslint-disable */
/**
* This file was auto-generated. DO NOT MODIFY DIRECTLY
* Instead, modify the source OpenAPI schema in back-end/src/api/openapi
* and run `yarn generate-api-types` to re-generate this file.
*/
import { z } from "zod";

export const listFeaturesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getFeatureValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const toggleFeatureValidator = {
  bodySchema: z.object({"reason":z.string().optional(),"environments":z.record(z.union([z.literal(true),z.literal(false),z.literal("true"),z.literal("false"),z.literal("1"),z.literal("0"),z.literal(1),z.literal(0),z.literal("")]))}).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listProjectsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getProjectValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listDimensionsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"datasourceId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getDimensionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listSegmentsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"datasourceId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getSegmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional(),"datasourceId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listSdkConnectionsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional(),"withProxy":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getSdkConnectionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listDataSourcesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getDataSourceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listExperimentsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional(),"datasourceId":z.string().optional(),"experimentId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const getExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const getExperimentResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"phase":z.string().optional(),"dimension":z.string().optional()}).strict(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listVisualChangesetsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const getVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"includeExperiment":z.coerce.number().int().optional()}).strict(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const putVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const postVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const putVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string(),"visualChangeId":z.string()}).strict(),
};