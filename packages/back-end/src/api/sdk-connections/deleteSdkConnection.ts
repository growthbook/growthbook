import { deleteSdkConnectionValidator } from "shared/validators";
import {
  findSDKConnectionById,
  deleteSDKConnectionModel,
} from "back-end/src/models/SdkConnectionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";

export const deleteSdkConnection = createApiRequestHandler(
  deleteSdkConnectionValidator,
)(async (req) => {
  const sdkConnection = await findSDKConnectionById(req.context, req.params.id);
  if (!sdkConnection) {
    throw new Error("Could not find sdkConnection with that id");
  }

  if (!req.context.permissions.canDeleteSDKConnection(sdkConnection)) {
    req.context.permissions.throwPermissionError();
  }

  // Archive-then-delete, as in the interactive route: the archive is the
  // reviewable step, so the hard delete of an archived connection needs none.
  if (!sdkConnection.archived) {
    throw new BadRequestError(
      "Archive the SDK connection before deleting it " +
        "(PUT /sdk-connections/{id} with `archived: true`).",
    );
  }

  await deleteSDKConnectionModel(req.context, sdkConnection);

  return {
    deletedId: req.params.id,
  };
});
