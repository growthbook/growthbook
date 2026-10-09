import { getSavedGroupValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { addLatestUploads } from "back-end/src/services/remoteSavedGroups";
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

    const [apiSavedGroup] = await addLatestUploads(req.context, [
      req.context.models.savedGroups.toApiInterface(savedGroup),
    ]);
    return {
      savedGroup: await resolveOwnerEmail(apiSavedGroup, req.context),
    };
  },
);
