import { getSavedGroupValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getSavedGroup = createApiRequestHandler(getSavedGroupValidator)(
  async (req) => {
    const savedGroup = await req.context.models.savedGroups.getById(
      req.params.id,
    );
    if (!savedGroup) {
      throw new NotFoundError("Could not find savedGroup with that id");
    }

    return {
      savedGroup: await resolveOwnerEmail(
        req.context.models.savedGroups.toApiInterface(savedGroup),
        req.context,
      ),
    };
  },
);
