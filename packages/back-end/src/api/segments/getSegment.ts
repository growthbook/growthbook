import { getSegmentValidator } from "@/src/validators/openapi";
import {
  findSegmentById,
  toSegmentApiInterface,
} from "@/src/models/SegmentModel";
import { GetSegmentResponse } from "@/types/openapi";
import { createApiRequestHandler } from "@/src/util/handler";

export const getSegment = createApiRequestHandler(getSegmentValidator)(
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
