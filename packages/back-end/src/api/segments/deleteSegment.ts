import { deleteSegmentValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteSegment = createApiRequestHandler(deleteSegmentValidator)(
  async (req) => {
    const id = req.params.id;
    await req.context.models.segments.deleteById(id);

    return {
      deletedId: id,
    };
  },
);
