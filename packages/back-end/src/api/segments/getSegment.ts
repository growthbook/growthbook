import { getSegmentValidator } from "@back-end/src/validators/openapi";
import {
  findSegmentById,
  toSegmentApiInterface,
} from "@back-end/src/models/SegmentModel";
import { GetSegmentResponse } from "@back-end/types/openapi";
import { createApiRequestHandler } from "@back-end/src/util/handler";

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
