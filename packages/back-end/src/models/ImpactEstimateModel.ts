import mongoose from "mongoose";
import { ImpactEstimateInterface } from "../../types/impact-estimate";
import uniqid from "uniqid";
import { getMetricById } from "../services/experiments";
import {
  getDataSourceById,
  getSourceIntegrationObject,
} from "../services/datasource";
import { QueryLanguage } from "../../types/datasource";
import { SegmentInterface } from "../../types/segment";
import { SegmentModel } from "./SegmentModel";

const impactEstimateSchema = new mongoose.Schema({
  id: String,
  organization: String,
  metric: String,
  regex: String,
  segment: String,
  metricTotal: Number,
  users: Number,
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
  organization: string,
  metric: string,
  segment: string | null,
  regex: string,
  value: number,
  users: number,
  metricTotal: number,
  query: string = "",
  queryLanguage: QueryLanguage = "none"
) {
  const doc = await ImpactEstimateModel.create({
    id: uniqid("est_"),
    organization,
    metric,
    segment,
    regex,
    users,
    value,
    metricTotal,
    query,
    queryLanguage,
    dateCreated: new Date(),
  });

  return doc;
}

export async function getImpactEstimate(
  organization: string,
  metric: string,
  regex: string,
  segment?: string
): Promise<ImpactEstimateDocument | null> {
  // Sanity check (no quotes allowed)
  if (!regex || regex.match(/['"]/g)) {
    throw new Error("Invalid page regex");
  }

  // Only re-use estimates that happened within the last 30 days
  const lastDate = new Date();
  lastDate.setDate(lastDate.getDate() - 30);

  const existing = await ImpactEstimateModel.findOne({
    organization,
    metric,
    segment: segment || null,
    regex,
    dateCreated: {
      $gt: lastDate,
    },
  });

  if (existing) {
    return existing;
  }

  const metricObj = await getMetricById(metric);
  if (!metricObj) {
    throw new Error("Metric not found");
  }
  if (metricObj.organization !== organization) {
    throw new Error("You don't have access to that metric");
  }

  if (!metricObj.datasource) {
    return null;
  }

  const datasource = await getDataSourceById(metricObj.datasource);
  if (!datasource) {
    throw new Error("Datasource not found");
  }
  if (datasource.organization !== organization) {
    throw new Error("You don't have access to that datasource");
  }

  let segmentObj: SegmentInterface;
  if (segment) {
    segmentObj = await SegmentModel.findOne({
      id: segment,
      organization,
      datasource: datasource.id,
    });
  }

  const integration = getSourceIntegrationObject(datasource);

  const data = await integration.getImpactEstimation(
    regex,
    metricObj,
    segmentObj
  );

  return createImpactEstimate(
    organization,
    metric,
    segment || null,
    regex,
    data.value,
    data.users,
    data.metricTotal,
    data.query,
    integration.getSourceProperties().queryLanguage
  );
}
