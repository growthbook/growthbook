import mongoose from "mongoose";
import { DimensionInterface } from "../../types/dimension";

const dimensionSchema = new mongoose.Schema({
  id: String,
  organization: String,
  datasource: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});
export type DimensionDocument = mongoose.Document & DimensionInterface;
export const DimensionModel = mongoose.model<DimensionDocument>(
  "Dimension",
  dimensionSchema
);
