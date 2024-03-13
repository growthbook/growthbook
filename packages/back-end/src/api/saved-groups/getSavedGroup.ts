import { getSavedGroupValidator } from "@back-end/src/validators/openapi";
import { GetSavedGroupResponse } from "@back-end/types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
} from "@back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getSavedGroup = createApiRequestHandler(getSavedGroupValidator)(
  async (req): Promise<GetSavedGroupResponse> => {
    const savedGroup = await getSavedGroupById(
      req.params.id,
      req.organization.id
    );
    if (!savedGroup) {
      throw new Error("Could not find savedGroup with that id");
    }

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  }
);
