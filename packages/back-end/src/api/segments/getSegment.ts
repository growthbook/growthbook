import { toSegmentApiInterface } from "../../services/segments";
import { createApiRequestHandler } from "../../util/handler";
import { GetSegmentResponse } from "../../../types/openapi";
import { getSegmentValidator } from "../../validators/openapi";

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
