import { getDimensionValidator } from "@back-end/src/validators/openapi";
import { GetDimensionResponse } from "@back-end/types/openapi";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "@back-end/src/models/DimensionModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getDimension = createApiRequestHandler(getDimensionValidator)(
  async (req): Promise<GetDimensionResponse> => {
    const dimension = await findDimensionById(
      req.params.id,
      req.organization.id
    );
    if (!dimension) {
      throw new Error("Could not find dimension with that id");
    }

    return {
      dimension: toDimensionApiInterface(dimension),
    };
  }
);
