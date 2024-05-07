import { GetSavedGroupResponse } from "../../../types/openapi";
import {
  getSavedGroupById,
  toSavedGroupApiInterface,
} from "../../models/SavedGroupModel";
import { createApiRequestHandler } from "../../util/handler";
import { getSavedGroupValidator } from "../../validators/openapi";

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
