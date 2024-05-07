import {
  findSegmentById,
  toSegmentApiInterface,
} from "../../models/SegmentModel";
import { createApiRequestHandler } from "../../util/handler";
import { GetSegmentResponse } from "../../../types/openapi";
import { getSegmentValidator } from "../../validators/openapi";

export const getSegment = createApiRequestHandler(getSegmentValidator)(async (
  req,
): Promise<GetSegmentResponse> => {
  const segment = await findSegmentById(req.params.id, req.organization.id);
  if (!segment) {
    throw new Error("Could not find segment with that id");
  }

  return {
    segment: toSegmentApiInterface(segment),
  };
});
