import mongoose from "mongoose";
import uniqid from "uniqid";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { ExperimentInterface } from "back-end/types/experiment";
import { blockSchema } from "./DashboardBlockModel";

export const dashboardInstanceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organizationId: String,
  experiment: String,
  dateCreated: Date,
  dateUpdated: Date,
  title: String,
  blocks: [blockSchema],
});

dashboardInstanceSchema.index({
  organizationId: 1,
  dateCreated: -1,
});

export type DashboardInstanceDocument = mongoose.Document &
  DashboardInstanceInterface;

export const DashboardInstanceModel = mongoose.model<DashboardInstanceInterface>(
  "DashboardInstance",
  dashboardInstanceSchema
);

export async function createDashboardInstance({
  data,
  context,
  experiment,
}: {
  data: Pick<DashboardInstanceInterface, "title" | "blocks">;
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}) {
  const dashboard = toInterface(
    await DashboardInstanceModel.create({
      ...data,
      id: uniqid("rep_"),
      organizationId: context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      experiment: experiment.id,
    })
  );

  return dashboard;
}

export async function updateDashboardInstance({
  context,
  dashboard,
  changes,
}: {
  context: ReqContext | ApiReqContext;
  dashboard: DashboardInstanceInterface;
  changes: Partial<DashboardInstanceInterface>;
}) {
  const allChanges = {
    ...changes,
    dateUpdated: new Date(),
  };

  await DashboardInstanceModel.updateOne(
    { id: dashboard.id, organizationId: context.org.id },
    { $set: allChanges }
  );

  const updated = { ...dashboard, ...allChanges };

  return toInterface(updated);
}

const toInterface: ToInterface<DashboardInstanceInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  return dashboard as DashboardInstanceInterface;
};
