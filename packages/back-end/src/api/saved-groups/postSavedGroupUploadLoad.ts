import { postSavedGroupUploadLoadValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { reportRemoteSavedGroupUploadLoad } from "back-end/src/services/remoteSavedGroups";

export const postSavedGroupUploadLoad = createApiRequestHandler(
  postSavedGroupUploadLoadValidator,
)(async (req) => ({
  upload: await reportRemoteSavedGroupUploadLoad(
    req.context,
    req.params.id,
    req.params.version,
    req.body,
  ),
}));
