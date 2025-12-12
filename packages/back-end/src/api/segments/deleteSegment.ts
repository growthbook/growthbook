import { deleteSegmentValidator } from "shared/validators";
import { DeleteSegmentResponse } from "shared/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSegment = createApiRequestHandler(deleteSegmentValidator)(
  async (req): Promise<DeleteSegmentResponse> => {
    const id = req.params.id;
    await req.context.models.segments.deleteById(id);

    return {
      deletedId: id,
    };
  },
);
