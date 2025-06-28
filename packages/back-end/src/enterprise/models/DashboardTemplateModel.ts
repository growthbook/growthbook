import mongoose from "mongoose";
import { DashboardTemplateInterface } from "back-end/src/enterprise/validators/dashboard-template";
import { dashboardBlockSchema } from "./DashboardBlockModel";

export const dashboardTemplateSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organizationId: String,
  dateCreated: Date,
  dateUpdated: Date,
  title: String,
  blocks: [dashboardBlockSchema],
});

dashboardTemplateSchema.index({
  organizationId: 1,
  dateCreated: -1,
});

export type DashboardTemplateDocument = mongoose.Document &
  DashboardTemplateInterface;

export const DashboardTemplateModel = mongoose.model<DashboardTemplateInterface>(
  "DashboardTemplate",
  dashboardTemplateSchema
);
