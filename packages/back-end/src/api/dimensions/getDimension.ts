import { getDimensionValidator } from "@/src/validators/openapi";
import { GetDimensionResponse } from "@/types/openapi";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "@/src/models/DimensionModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
