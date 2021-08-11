import mongoose from "mongoose";
import { DimensionInterface } from "../../types/dimension";

const dimensionSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  datasource: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});
export type DimensionDocument = mongoose.Document & DimensionInterface;
const DimensionModel = mongoose.model<DimensionDocument>(
  "Dimension",
  dimensionSchema
);

export function createDimension(dimension: Partial<DimensionInterface>) {
  return DimensionModel.create(dimension);
}

export function findDimensionsByOrganization(organization: string) {
  return DimensionModel.find({ organization });
}

export function findDimensionById(id: string) {
  return DimensionModel.findOne({ id });
}

export function findDimensionsByDataSource(datasource: string) {
  return DimensionModel.find({ datasource });
}
