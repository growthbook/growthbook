import { listSavedGroupUploadsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { listRemoteSavedGroupUploads } from "back-end/src/services/remoteSavedGroups";

export const listSavedGroupUploads = createApiRequestHandler(
  listSavedGroupUploadsValidator,
)(async (req) => ({
  uploads: await listRemoteSavedGroupUploads(req.context, req.params.id),
}));
