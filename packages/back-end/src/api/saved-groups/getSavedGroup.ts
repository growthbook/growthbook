import { GetSavedGroupResponse } from "shared/types/openapi";
import { getSavedGroupValidator } from "shared/validators";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
} from "back-end/src/models/SavedGroupModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSavedGroup = createApiRequestHandler(getSavedGroupValidator)(
  async (req): Promise<GetSavedGroupResponse> => {
    const savedGroup = await getSavedGroupById(
      req.params.id,
      req.organization.id,
    );
    if (!savedGroup) {
      throw new Error("Could not find savedGroup with that id");
    }

    return {
      savedGroup: toSavedGroupApiInterface(savedGroup),
    };
  },
);
