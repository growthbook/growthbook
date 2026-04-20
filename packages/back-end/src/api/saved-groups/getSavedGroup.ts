import { getSavedGroupValidator } from "shared/validators";
import { buildOwnerEmailMap } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSavedGroup = createApiRequestHandler(getSavedGroupValidator)(
  async (req) => {
    const savedGroup = await req.context.models.savedGroups.getById(
      req.params.id,
    );
    if (!savedGroup) {
      throw new Error("Could not find savedGroup with that id");
    }

    const ownerEmailMap = await buildOwnerEmailMap(
      [savedGroup.owner],
      req.context,
    );
    return {
      savedGroup: req.context.models.savedGroups.toApiInterface(
        savedGroup,
        ownerEmailMap,
      ),
    };
  },
);
