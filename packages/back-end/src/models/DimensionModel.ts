import mongoose from "mongoose";
import { ApiDimension } from "../../types/openapi";
import { DimensionInterface } from "../../types/dimension";
import { getConfigDimensions, usingFileConfig } from "../init/config";

const dimensionSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  owner: String,
  datasource: String,
  userIdType: String,
  description: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});
dimensionSchema.index({ id: 1, organization: 1 }, { unique: true });
type DimensionDocument = mongoose.Document & DimensionInterface;
const DimensionModel = mongoose.model<DimensionInterface>(
  "Dimension",
  dimensionSchema
);

function toInterface(doc: DimensionDocument): DimensionInterface {
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

  const doc = await DimensionModel.findOne({ id, organization });

  return doc ? toInterface(doc) : null;
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
  organization: string,
  updates: Partial<DimensionInterface>
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    throw new Error(
      "Cannot update. Dimensions are being managed by config.yml"
    );
  }

  await DimensionModel.updateOne({ id, organization }, { $set: updates });
}

export async function deleteDimensionById(id: string, organization: string) {
  // If using config.yml, immediately throw error
  if (usingFileConfig()) {
    throw new Error(
      "Cannot delete. Dimensions are being managed by config.yml"
    );
  }

  await DimensionModel.deleteOne({
    id,
    organization,
  });
}

export function toDimensionApiInterface(
  dimension: DimensionInterface
): ApiDimension {
  return {
    id: dimension.id,
    name: dimension.name,
    owner: dimension.owner || "",
    identifierType: dimension.userIdType || "user_id",
    query: dimension.sql,
    datasourceId: dimension.datasource || "",
    dateCreated: dimension.dateCreated?.toISOString() || "",
    dateUpdated: dimension.dateUpdated?.toISOString() || "",
  };
}
