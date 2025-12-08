import mongoose from "mongoose";
import { ApiDimension } from "back-end/types/openapi";
import { DimensionInterface } from "back-end/types/dimension";
import { getConfigDimensions, usingFileConfig } from "back-end/src/init/config";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { ALLOW_CREATE_DIMENSIONS } from "../util/secrets";

const dimensionSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  owner: String,
  managedBy: String,
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
  dimensionSchema,
);

function toInterface(doc: DimensionDocument): DimensionInterface {
  return doc.toJSON();
}

export async function createDimension(dimension: Partial<DimensionInterface>) {
  if (usingFileConfig() && !ALLOW_CREATE_DIMENSIONS) {
    throw new Error(
      "Cannot add new dimensions. Dimensions managed by config.yml",
    );
  }
  return toInterface(await DimensionModel.create(dimension));
}

export async function findDimensionsByOrganization(organization: string) {
  const dimensions: DimensionInterface[] = [];
  // If using config.yml, fetch from there
  if (usingFileConfig()) {
    getConfigDimensions(organization).forEach((d) => {
      dimensions.push(d);
    });

    // If dimensions are locked down to just a config file, return immediately
    if (!ALLOW_CREATE_DIMENSIONS) {
      return dimensions;
    }
  }

  const docs = await DimensionModel.find({ organization });
  docs.forEach((d) => {
    dimensions.push(toInterface(d));
  });
  return dimensions;
}

export async function findDimensionById(id: string, organization: string) {
  // If using config.yml, check there first
  if (usingFileConfig()) {
    const doc = getConfigDimensions(organization).filter((d) => d.id === id)[0];
    if (doc) {
      return doc;
    }

    // If dimensions are locked down to just a config file & the dimension is not found, return null
    if (!ALLOW_CREATE_DIMENSIONS) {
      return null;
    }
  }

  const doc = await DimensionModel.findOne({ id, organization });

  return doc ? toInterface(doc) : null;
}

export async function findDimensionsByDataSource(
  datasource: string,
  organization: string,
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDimensions(organization).filter(
      (d) => d.datasource === datasource,
    );
  }

  return (await DimensionModel.find({ datasource, organization })).map(
    toInterface,
  );
}

export async function updateDimension(
  context: ReqContext | ApiReqContext,
  existing: DimensionInterface,
  updates: Partial<DimensionInterface>,
) {
  // If the dimension is managed by the config.yml, don't allow updates
  if (existing.managedBy === "config") {
    throw new Error("Cannot update. Dimenision managed by config.yml");
  }
  // If the dimension is managed by the API, only allow updates via the API
  if (existing.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("Cannot update. Dimenision managed by the API");
  }

  await DimensionModel.updateOne(
    { id: existing.id, organization: context.org.id },
    { $set: updates },
  );
}

export async function deleteDimensionById(
  context: ReqContext | ApiReqContext,
  dimension: DimensionInterface,
) {
  if (dimension?.managedBy === "config") {
    throw new Error(
      "Cannot delete. This Dimension is being managed by config.yml",
    );
  }

  if (dimension?.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error(
      "Cannot delete. This Dimension is being managed by the API",
    );
  }

  await DimensionModel.deleteOne({
    id: dimension.id,
    organization: context.org.id,
  });
}

export function toDimensionApiInterface(
  dimension: DimensionInterface,
): ApiDimension {
  return {
    id: dimension.id,
    name: dimension.name,
    description: dimension.description || "",
    owner: dimension.owner || "",
    identifierType: dimension.userIdType || "user_id",
    query: dimension.sql,
    datasourceId: dimension.datasource || "",
    dateCreated: dimension.dateCreated?.toISOString() || "",
    dateUpdated: dimension.dateUpdated?.toISOString() || "",
    managedBy: dimension.managedBy || "",
  };
}
