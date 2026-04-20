import { getSegmentValidator } from "shared/validators";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { buildOwnerEmailMap } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSegment = createApiRequestHandler(getSegmentValidator)(async (
  req,
) => {
  const segment = await req.context.models.segments.getById(req.params.id);
  if (!segment) {
    throw new Error("Could not find segment with that id");
  }

  const ownerEmailMap = await buildOwnerEmailMap([segment.owner], req.context);
  return {
    segment: toSegmentApiInterface(segment, ownerEmailMap),
  };
});
