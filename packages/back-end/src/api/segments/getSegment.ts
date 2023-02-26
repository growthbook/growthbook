import { z } from "zod";
import {
  findSegmentById,
  toSegmentApiInterface,
} from "../../models/SegmentModel";
import { createApiRequestHandler } from "../../util/handler";
import { GetSegmentResponse } from "../../../types/openapi";

export const getSegment = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<GetSegmentResponse> => {
    const segment = await findSegmentById(req.params.id, req.organization.id);
    if (!segment) {
      throw new Error("Could not find segment with that id");
    }

    return {
      segment: toSegmentApiInterface(segment),
    };
  }
);
