import { toSegmentApiInterface } from "back-end/src/services/segments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { GetSegmentResponse } from "back-end/types/openapi";
import { getSegmentValidator } from "back-end/src/validators/openapi";

export const getSegment = createApiRequestHandler(getSegmentValidator)(
  async (req): Promise<GetSegmentResponse> => {
    const segment = await req.context.models.segments.getById(req.params.id);
    if (!segment) {
      throw new Error("Could not find segment with that id");
    }

    return {
      segment: toSegmentApiInterface(segment),
    };
  }
);
