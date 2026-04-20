import { getDimensionValidator } from "shared/validators";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { buildOwnerEmailMap } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getDimension = createApiRequestHandler(getDimensionValidator)(
  async (req) => {
    const dimension = await findDimensionById(
      req.params.id,
      req.organization.id,
    );
    if (!dimension) {
      throw new Error("Could not find dimension with that id");
    }

    const ownerEmailMap = await buildOwnerEmailMap(
      [dimension.owner],
      req.context,
    );
    return {
      dimension: toDimensionApiInterface(dimension, ownerEmailMap),
    };
  },
);
