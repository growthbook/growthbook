import { deleteDimensionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  findDimensionById,
  hasDimensionDatasourceAccess,
  deleteDimensionById,
} from "back-end/src/models/DimensionModel";

export const deleteDimension = createApiRequestHandler(
  deleteDimensionValidator,
)(async (req) => {
  if (!req.context.permissions.canDeleteDimension()) {
    req.context.permissions.throwPermissionError();
  }

  const organization = req.organization.id;
  const dimension = await findDimensionById(req.params.id, organization);

  if (!dimension) {
    throw new Error("Could not find dimension with that id");
  }
  if (!(await hasDimensionDatasourceAccess(req.context, dimension))) {
    throw new Error("You don't have access to this dimension");
  }

  await deleteDimensionById(req.context, dimension);

  return {
    deletedId: dimension.id,
  };
});
