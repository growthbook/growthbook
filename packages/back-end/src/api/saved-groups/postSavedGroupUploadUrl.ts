import { postSavedGroupUploadUrlValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getRemoteSavedGroupUploadUrl } from "back-end/src/services/remoteSavedGroups";

export const postSavedGroupUploadUrl = createApiRequestHandler(
  postSavedGroupUploadUrlValidator,
)(async (req) => {
  const upload = await getRemoteSavedGroupUploadUrl(req.context, req.params.id);
  return { ...upload, expiresAt: upload.expiresAt.toISOString() };
});
