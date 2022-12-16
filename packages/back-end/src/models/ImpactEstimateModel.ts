import mongoose from "mongoose";
import uniqid from "uniqid";
import { ImpactEstimateInterface } from "../../types/impact-estimate";
import { getMetricById } from "../models/MetricModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { SegmentInterface } from "../../types/segment";
import { processMetricValueQueryResponse } from "../services/queries";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { SegmentModel } from "./SegmentModel";
import { getDataSourceById } from "./DataSourceModel";

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

export const ImpactEstimateModel = mongoose.model<ImpactEstimateDocument>(
  "ImpactEstimate",
  impactEstimateSchema
);

export async function createImpactEstimate(
  data: Partial<ImpactEstimateInterface>
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
  organization: string,
  metric: string,
  numDays: number,
  segment?: string
): Promise<ImpactEstimateDocument | null> {
  const metricObj = await getMetricById(metric, organization);
  if (!metricObj) {
    throw new Error("Metric not found");
  }

  if (!metricObj.datasource) {
    return null;
  }

  const datasource = await getDataSourceById(
    metricObj.datasource,
    organization
  );
  if (!datasource) {
    throw new Error("Datasource not found");
  }

  let segmentObj: SegmentInterface | null = null;
  if (segment) {
    segmentObj = await SegmentModel.findOne({
      id: segment,
      organization,
      datasource: datasource.id,
    });
  }

  const integration = getSourceIntegrationObject(datasource);
  if (integration.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  const conversionWindowHours =
    metricObj.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

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
  });

  const queryResponse = await integration.runMetricValueQuery(query);
  const value = processMetricValueQueryResponse(queryResponse);

  let daysWithData = numDays;
  if (value.dates && value.dates.length > 0) {
    daysWithData = value.dates.length;
  }

  const conversionsPerDay = value.count / daysWithData;

  return createImpactEstimate({
    organization,
    metric,
    segment: segment || undefined,
    conversionsPerDay: conversionsPerDay,
    query: query,
    queryLanguage: integration.getSourceProperties().queryLanguage,
  });
}
