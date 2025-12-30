import { DeleteDimensionResponse } from "shared/types/openapi";
import { deleteDimensionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  findDimensionById,
  deleteDimensionById,
} from "back-end/src/models/DimensionModel";

export const deleteDimension = createApiRequestHandler(
  deleteDimensionValidator,
)(async (req): Promise<DeleteDimensionResponse> => {
  const organization = req.organization.id;
  const dimension = await findDimensionById(req.params.id, organization);

  if (!dimension) {
    throw new Error("Could not find dimension with that id");
  }

  await deleteDimensionById(req.context, dimension);

  return {
    deletedId: dimension.id,
  };
});
