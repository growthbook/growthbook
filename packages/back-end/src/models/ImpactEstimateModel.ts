import mongoose from "mongoose";
import uniqid from "uniqid";
import { getMetricWindowHours } from "shared/experiments";
import { SegmentInterface } from "shared/types/segment";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import { getMetricById } from "back-end/src/models/MetricModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "back-end/src/util/secrets";
import { processMetricValueQueryResponse } from "back-end/src/queryRunners/LegacyMetricAnalysisQueryRunner";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import { getFactTableMap } from "./FactTableModel";

const impactEstimateSchema = new mongoose.Schema({
  id: String,
  organization: String,
  metric: String,
  segment: String,
  conversionsPerDay: Number,
  query: String,
  queryLanguage: String,
  dateCreated: Date,
});
export type ImpactEstimateDocument = mongoose.Document &
  ImpactEstimateInterface;

export const ImpactEstimateModel = mongoose.model<ImpactEstimateInterface>(
  "ImpactEstimate",
  impactEstimateSchema,
);

export async function createImpactEstimate(
  data: Partial<ImpactEstimateInterface>,
) {
  const doc = await ImpactEstimateModel.create({
    query: "",
    queryLanguage: "none",
    ...data,
    id: uniqid("est_"),
    dateCreated: new Date(),
  });

  return doc;
}

export async function getImpactEstimate(
  context: ReqContext | ApiReqContext,
  metric: string,
  numDays: number,
  segment?: string,
): Promise<ImpactEstimateDocument | null> {
  const metricObj = await getMetricById(context, metric);
  if (!metricObj) {
    throw new Error("Metric not found");
  }

  if (!metricObj.datasource) {
    return null;
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    metricObj.datasource,
    true,
  );

  if (!context.permissions.canRunMetricQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }

  let segmentObj: SegmentInterface | null = null;
  if (segment) {
    segmentObj = await context.models.segments.getById(segment);
  }

  if (segmentObj?.datasource !== metricObj.datasource) {
    segmentObj = null;
  }

  const factTableMap = await getFactTableMap(context);

  const conversionWindowHours =
    getMetricWindowHours(metricObj.windowSettings) ||
    DEFAULT_CONVERSION_WINDOW_HOURS;

  // Ignore last X hours of data since we need to give people time to convert
  const end = new Date();
  end.setHours(end.getHours() - conversionWindowHours);
  const start = new Date();
  start.setDate(start.getDate() - numDays);
  start.setHours(start.getHours() - conversionWindowHours);

  const query = integration.getMetricValueQuery({
    from: start,
    to: end,
    name: "Metric Value",
    metric: metricObj,
    includeByDate: true,
    segment: segmentObj || undefined,
    factTableMap,
  });

  const queryResponse = await integration.runMetricValueQuery(
    query,
    // We're not storing a query in Mongo for this, so we don't support cancelling here
    async () => {
      // Ignore calls to setExternalId
    },
  );
  const value = processMetricValueQueryResponse(queryResponse.rows);

  let daysWithData = numDays;
  if (value.dates && value.dates.length > 0) {
    daysWithData = value.dates.length;
  }

  const conversionsPerDay = value.count / daysWithData;

  return createImpactEstimate({
    organization: context.org.id,
    metric,
    segment: segment || undefined,
    conversionsPerDay: conversionsPerDay,
    query: query,
    queryLanguage: integration.getSourceProperties().queryLanguage,
  });
}
