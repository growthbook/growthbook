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

export const postExperimentValidator = {
  bodySchema: z.object({"datasourceId":z.string().describe("ID for the [DataSource](#tag/DataSource_model)"),"assignmentQueryId":z.string().describe("The ID property of one of the assignment query objects associated with the datasource"),"trackingKey":z.string(),"name":z.string().describe("Name of the experiment"),"project":z.string().describe("Project ID which the experiment belongs to").optional(),"hypothesis":z.string().describe("Hypothesis of the experiment").optional(),"description":z.string().describe("Description of the experiment").optional(),"tags":z.array(z.string()).optional(),"metrics":z.array(z.string()).optional(),"owner":z.string().describe("Email of the person who owns this experiment"),"archived":z.boolean().optional(),"status":z.enum(["draft","running","stopped"]).optional(),"autoRefresh":z.boolean().optional(),"hashAttribute":z.string().optional(),"hashVersion":z.union([z.literal(1),z.literal(2)]).optional(),"releasedVariationId":z.string().optional(),"excludeFromPayload":z.boolean().optional(),"variations":z.array(z.object({"id":z.string().optional(),"key":z.string(),"name":z.string(),"description":z.string().optional(),"screenshots":z.array(z.object({"path":z.string(),"width":z.number().optional(),"height":z.number().optional(),"description":z.string().optional()})).optional()})).min(2),"phases":z.array(z.object({"name":z.string(),"dateStarted":z.string(),"dateEnded":z.string().optional(),"reasonForStopping":z.string().optional(),"seed":z.string().optional(),"coverage":z.number().optional(),"trafficSplit":z.array(z.object({"variationId":z.string(),"weight":z.number()})).optional(),"namespace":z.object({"namespaceId":z.string(),"range":z.array(z.number()).min(2).max(2),"enabled":z.boolean().optional()}).optional(),"targetingCondition":z.string().optional(),"reason":z.string().optional(),"condition":z.string().optional(),"variationWeights":z.array(z.number()).optional()})).optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const updateExperimentValidator = {
  bodySchema: z.object({"assignmentQueryId":z.string().optional(),"trackingKey":z.string().optional(),"name":z.string().describe("Name of the experiment").optional(),"project":z.string().describe("Project ID which the experiment belongs to").optional(),"hypothesis":z.string().describe("Hypothesis of the experiment").optional(),"description":z.string().describe("Description of the experiment").optional(),"tags":z.array(z.string()).optional(),"metrics":z.array(z.string()).optional(),"owner":z.string().describe("Email of the person who owns this experiment").optional(),"archived":z.boolean().optional(),"status":z.enum(["draft","running","stopped"]).optional(),"autoRefresh":z.boolean().optional(),"hashAttribute":z.string().optional(),"hashVersion":z.union([z.literal(1),z.literal(2)]).optional(),"releasedVariationId":z.string().optional(),"excludeFromPayload":z.boolean().optional(),"variations":z.array(z.object({"id":z.string().optional(),"key":z.string(),"name":z.string(),"description":z.string().optional(),"screenshots":z.array(z.object({"path":z.string(),"width":z.number().optional(),"height":z.number().optional(),"description":z.string().optional()})).optional()})).min(2).optional(),"phases":z.array(z.object({"name":z.string(),"dateStarted":z.string(),"dateEnded":z.string().optional(),"reasonForStopping":z.string().optional(),"seed":z.string().optional(),"coverage":z.number().optional(),"trafficSplit":z.array(z.object({"variationId":z.string(),"weight":z.number()})).optional(),"namespace":z.object({"namespaceId":z.string(),"range":z.array(z.number()).min(2).max(2),"enabled":z.boolean().optional()}).optional(),"targetingCondition":z.string().optional(),"reason":z.string().optional(),"condition":z.string().optional(),"variationWeights":z.array(z.number()).optional()})).optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const getExperimentResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"phase":z.string().optional(),"dimension":z.string().optional()}).strict(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const listMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional(),"projectId":z.string().optional(),"datasourceId":z.string().optional()}).strict(),
  paramsSchema: z.never(),
};

export const postMetricValidator = {
  bodySchema: z.object({"datasourceId":z.string().describe("ID for the [DataSource](#tag/DataSource_model)"),"owner":z.string().describe("Name of the person who owns this metric").optional(),"name":z.string().describe("Name of the metric"),"description":z.string().describe("Description of the metric").optional(),"type":z.enum(["binomial","count","duration","revenue"]).describe("Type of metric. See [Metrics documentation](/app/metrics)"),"tags":z.array(z.string()).describe("List of tags").optional(),"projects":z.array(z.string()).describe("List of project IDs for projects that can access this metric").optional(),"archived":z.boolean().optional(),"behavior":z.object({"goal":z.enum(["increase","decrease"]).optional(),"cap":z.number().gte(0).describe("(deprecated, use capping and capValue fields instead) This should be non-negative").optional(),"capping":z.enum(["absolute","percentile"]).describe("Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.").nullable().describe("Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.").optional(),"capValue":z.number().gte(0).describe("This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.").optional(),"conversionWindowStart":z.number().describe("The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(),"conversionWindowEnd":z.number().describe("The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(),"riskThresholdSuccess":z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(),"riskThresholdDanger":z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(),"minPercentChange":z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(),"maxPercentChange":z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(),"minSampleSize":z.number().gte(0).optional()}).optional(),"sql":z.object({"identifierTypes":z.array(z.string()),"conversionSQL":z.string(),"userAggregationSQL":z.string().describe("Custom user level aggregation for your metric (default: `SUM(value)`)").optional(),"denominatorMetricId":z.string().describe("The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics)").optional()}).describe("Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional(),"sqlBuilder":z.object({"identifierTypeColumns":z.array(z.object({"identifierType":z.string(),"columnName":z.string()})),"tableName":z.string(),"valueColumnName":z.string().optional(),"timestampColumnName":z.string(),"conditions":z.array(z.object({"column":z.string(),"operator":z.string(),"value":z.string()})).optional()}).describe("An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional(),"mixpanel":z.object({"eventName":z.string(),"eventValue":z.string().optional(),"userAggregation":z.string(),"conditions":z.array(z.object({"property":z.string(),"operator":z.string(),"value":z.string()})).optional()}).describe("Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const putMetricValidator = {
  bodySchema: z.object({"owner":z.string().describe("Name of the person who owns this metric").optional(),"name":z.string().describe("Name of the metric").optional(),"description":z.string().describe("Description of the metric").optional(),"type":z.enum(["binomial","count","duration","revenue"]).describe("Type of metric. See [Metrics documentation](/app/metrics)").optional(),"tags":z.array(z.string()).describe("List of tags").optional(),"projects":z.array(z.string()).describe("List of project IDs for projects that can access this metric").optional(),"archived":z.boolean().optional(),"behavior":z.object({"goal":z.enum(["increase","decrease"]).optional(),"capping":z.enum(["absolute","percentile"]).describe("Used in conjunction with `capValue` to set the capping (winsorization). Set to null to turn capping off. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/> If `behavior.capping` is non-null, you must specify `behavior.capValue`.").nullable().describe("Used in conjunction with `capValue` to set the capping (winsorization). Set to null to turn capping off. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/> If `behavior.capping` is non-null, you must specify `behavior.capValue`.").optional(),"capValue":z.number().gte(0).describe("This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.").optional(),"conversionWindowStart":z.number().describe("The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(),"conversionWindowEnd":z.number().describe("The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(),"riskThresholdSuccess":z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(),"riskThresholdDanger":z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(),"minPercentChange":z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(),"maxPercentChange":z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(),"minSampleSize":z.number().gte(0).optional()}).optional(),"sql":z.object({"identifierTypes":z.array(z.string()).optional(),"conversionSQL":z.string().optional(),"userAggregationSQL":z.string().describe("Custom user level aggregation for your metric (default: `SUM(value)`)").optional(),"denominatorMetricId":z.string().describe("The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics)").optional()}).describe("Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.").optional(),"sqlBuilder":z.object({"identifierTypeColumns":z.array(z.object({"identifierType":z.string(),"columnName":z.string()})).optional(),"tableName":z.string().optional(),"valueColumnName":z.string().optional(),"timestampColumnName":z.string().optional(),"conditions":z.array(z.object({"column":z.string(),"operator":z.string(),"value":z.string()})).optional()}).describe("An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed").optional(),"mixpanel":z.object({"eventName":z.string().optional(),"eventValue":z.string().optional(),"userAggregation":z.string().optional(),"conditions":z.array(z.object({"property":z.string(),"operator":z.string(),"value":z.string()})).optional()}).describe("Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.").optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const deleteMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
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

export const listSavedGroupsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({"limit":z.coerce.number().int().default(10),"offset":z.coerce.number().int().optional()}).strict(),
  paramsSchema: z.never(),
};

export const postSavedGroupValidator = {
  bodySchema: z.object({"name":z.string().describe("The display name of the Saved Group"),"values":z.array(z.string()).describe("An array of values to target (Ex: a list of userIds)."),"attributeKey":z.string().describe("The parameter you want to target users with. Ex: userId, orgId, ..."),"owner":z.string().describe("The person or team that owns this Saved Group. If no owner, you can pass an empty string.").optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const updateSavedGroupValidator = {
  bodySchema: z.object({"name":z.string().describe("The display name of the Saved Group").optional(),"values":z.array(z.string()).describe("An array of values to target (Ex: a list of userIds).").optional(),"owner":z.string().describe("The person or team that owns this Saved Group. If no owner, you can pass an empty string.").optional()}).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};

export const deleteSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({"id":z.string()}).strict(),
};