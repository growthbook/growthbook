import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";
import {
  CreateMetricGroupProps,
  MetricGroupInterface,
} from "../../types/metric-groups";

const metricGroupSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String },
  organization: { type: String, required: true },
  owner: { type: String },
  datasource: { type: String, required: true },
  projects: [{ type: String }],
  tags: [{ type: String }],
  metrics: [{ type: String }],
  dateCreated: { type: Date, default: Date.now },
});

metricGroupSchema.index({ id: 1, organization: 1 }, { unique: true });

type MetricGroupDocument = mongoose.Document & MetricGroupInterface;

export const MetricGroupModel = mongoose.model<MetricGroupInterface>(
  "MetricGroup",
  metricGroupSchema
);

function toInterface(doc: MetricGroupDocument): MetricGroupInterface {
  const ret = doc.toJSON<MetricGroupDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getAllMetricGroupsForOrganization(orgId: string) {
  const docs = await MetricGroupModel.find({ organization: orgId });
  return docs.map((doc) => toInterface(doc));
}

export async function getMetricGroupById(
  context: ReqContext | ApiReqContext,
  id: string
) {
  const doc = await MetricGroupModel.findOne({
    id,
    organization: context.org.id,
  });
  if (!doc) {
    return null;
  }
  const metricGroup = toInterface(doc);
  if (!context.permissions.canReadMultiProjectResource(metricGroup.projects)) {
    return null;
  }
  return metricGroup;
}

// create a metric group
export async function createMetricGroup(
  context: ReqContext | ApiReqContext,
  data: CreateMetricGroupProps | MetricGroupInterface
) {
  const id = uniqid("mg_");

  const doc = await MetricGroupModel.create({
    ...data,
    organization: context.org.id,
    id,
    owner: context.userId,
    dateCreated: new Date(),
  });
  return toInterface(doc);
}

// update a metric group
export async function updateMetricGroup(
  context: ReqContext | ApiReqContext,
  id: string,
  data: Partial<MetricGroupInterface>
) {
  const metricGroup = await MetricGroupModel.findOne({
    id,
    organization: context.org.id,
  });
  if (!metricGroup) {
    throw new Error("Metric group not found");
  }
  await MetricGroupModel.updateOne(
    { organization: context.org.id, id },
    {
      $set: data,
    }
  );
}

export async function deleteMetricGroupById(id: string) {
  await MetricGroupModel.deleteOne({ id });
}
