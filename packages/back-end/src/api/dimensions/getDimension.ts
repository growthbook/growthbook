import { z } from "zod";
import { GetDimensionResponse } from "../../../types/api";
import {
  findDimensionById,
  toDimensionApiInterface,
} from "../../models/DimensionModel";
import { createApiRequestHandler } from "../../util/handler";

export const getDimension = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
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
