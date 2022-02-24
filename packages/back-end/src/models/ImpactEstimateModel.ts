import mongoose from "mongoose";
import { ImpactEstimateInterface } from "../../types/impact-estimate";
import uniqid from "uniqid";
import { getMetricById } from "../models/MetricModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { SegmentInterface } from "../../types/segment";
import { SegmentModel } from "./SegmentModel";
import { getDataSourceById } from "./DataSourceModel";

const impactEstimateSchema = new mongoose.Schema({
  id: String,
  organization: String,
  metric: String,
  segment: String,
  metricTotal: Number,
  value: Number,
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
  segment?: string
): Promise<ImpactEstimateDocument | null> {
  // Only re-use estimates that happened within the last 30 days
  const lastDate = new Date();
  lastDate.setDate(lastDate.getDate() - 30);

  const existing = await ImpactEstimateModel.findOne({
    organization,
    metric,
    segment: segment || undefined,
    dateCreated: {
      $gt: lastDate,
    },
  });

  if (existing) {
    return existing;
  }

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

  const data = await integration.getImpactEstimation(
    metricObj,
    segmentObj || undefined
  );

  return createImpactEstimate({
    organization,
    metric,
    segment: segment || undefined,
    value: data.value,
    metricTotal: data.metricTotal,
    query: data.query,
    queryLanguage: integration.getSourceProperties().queryLanguage,
  });
}
