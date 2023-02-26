import { z } from "zod";
import { ApiSegmentInterface } from "../../../types/api";
import {
  findSegmentById,
  toSegmentApiInterface,
} from "../../models/SegmentModel";
import { createApiRequestHandler } from "../../util/handler";

export const getSegment = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<{ segment: ApiSegmentInterface }> => {
    const segment = await findSegmentById(req.params.id, req.organization.id);
    if (!segment) {
      throw new Error("Could not find segment with that id");
    }

    return {
      segment: toSegmentApiInterface(segment),
    };
  }
);
