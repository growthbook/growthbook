import mongoose from "mongoose";
import { DimensionInterface } from "../../types/dimension";
import { getConfigDimensions, usingFileConfig } from "../init/config";

const dimensionSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  projects: [String],
  datasource: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});
type DimensionDocument = mongoose.Document & DimensionInterface;
const DimensionModel = mongoose.model<DimensionDocument>(
  "Dimension",
  dimensionSchema
);

function toInterface(doc: DimensionDocument): DimensionInterface {
  if (!doc) return null;
  return doc.toJSON();
}

export async function createDimension(dimension: Partial<DimensionInterface>) {
  return toInterface(await DimensionModel.create(dimension));
}

export async function findDimensionsByOrganization(organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDimensions(organization);
  }

  return (await DimensionModel.find({ organization })).map(toInterface);
}

export async function findDimensionById(id: string, organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDimensions(organization).filter((d) => d.id === id)[0];
  }

  return toInterface(await DimensionModel.findOne({ id, organization }));
}

export async function findDimensionsByDataSource(
  datasource: string,
  organization: string
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDimensions(organization).filter(
      (d) => d.datasource === datasource
    );
  }

  return (await DimensionModel.find({ datasource, organization })).map(
    toInterface
  );
}

export async function updateDimension(
  id: string,
  updates: Partial<DimensionInterface>
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    throw new Error(
      "Cannot update. Dimensions are being managed by config.yml"
    );
  }

  await DimensionModel.updateOne({ id }, { $set: updates });
}
