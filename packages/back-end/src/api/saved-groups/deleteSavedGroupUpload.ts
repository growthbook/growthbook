import { deleteSavedGroupUploadValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteRemoteSavedGroupUpload } from "back-end/src/services/remoteSavedGroups";

export const deleteSavedGroupUpload = createApiRequestHandler(
  deleteSavedGroupUploadValidator,
)(async (req) => {
  await deleteRemoteSavedGroupUpload(
    req.context,
    req.params.id,
    req.params.version,
  );
  return { deletedVersion: req.params.version };
});
