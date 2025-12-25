import { GetSavedGroupResponse } from "shared/types/openapi";
import { getSavedGroupValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSavedGroup = createApiRequestHandler(getSavedGroupValidator)(
  async (req): Promise<GetSavedGroupResponse> => {
    const savedGroup = await req.context.models.savedGroups.getById(
      req.params.id,
    );
    if (!savedGroup) {
      throw new Error("Could not find savedGroup with that id");
    }

    return {
      savedGroup: req.context.models.savedGroups.toApiInterface(savedGroup),
    };
  },
);
