import { postSavedGroupUploadValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { createRemoteSavedGroupUpload } from "back-end/src/services/remoteSavedGroups";

export const postSavedGroupUpload = createApiRequestHandler(
  postSavedGroupUploadValidator,
)(async (req) => ({
  upload: await createRemoteSavedGroupUpload(
    req.context,
    req.params.id,
    req.body.fileKey,
  ),
}));
