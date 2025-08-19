import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteSegmentValidator } from "back-end/src/validators/openapi";
import { DeleteSegmentResponse } from "back-end/types/openapi";

export const deleteSegment = createApiRequestHandler(deleteSegmentValidator)(
  async (req): Promise<DeleteSegmentResponse> => {
    const id = req.params.id;
    await req.context.models.segments.deleteById(id);

    return {
      deletedId: id,
    };
  },
);
