import { updateDimensionValidator } from "shared/validators";
import { DimensionInterface } from "shared/types/dimension";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  findDimensionById,
  updateDimension as updateDimensionModel,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const updateDimension = createApiRequestHandler(
  updateDimensionValidator,
)(async (req) => {
  const organization = req.organization.id;
  const dimension = await findDimensionById(req.params.id, organization);

  if (!dimension) {
    throw new Error("Could not find dimension with that id");
  }
  if (req.body.datasourceId) {
    const datasourceDoc = await getDataSourceById(
      req.context,
      req.body.datasourceId,
    );
    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }
  }

  const updates: Partial<DimensionInterface> = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.description !== undefined) {
    updates.description = req.body.description;
  }
  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  if (req.body.owner !== undefined) updates.owner = resolvedOwner ?? "";
  if (req.body.datasourceId) updates.datasource = req.body.datasourceId;
  if (req.body.identifierType) updates.userIdType = req.body.identifierType;
  if (req.body.query) updates.sql = req.body.query;
  if (req.body.managedBy !== undefined) {
    updates.managedBy = req.body.managedBy;
  }
  updates.dateUpdated = new Date();

  await updateDimensionModel(req.context, dimension, updates);

  const updatedDimension = { ...dimension, ...updates };
  return {
    dimension: await resolveOwnerEmail(
      toDimensionApiInterface(updatedDimension),
      req.context,
    ),
  };
});
