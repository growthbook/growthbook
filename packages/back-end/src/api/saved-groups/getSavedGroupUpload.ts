import { getSavedGroupUploadValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  findRemoteSavedGroupUpload,
  toApiSavedGroupUpload,
} from "back-end/src/services/remoteSavedGroups";

export const getSavedGroupUpload = createApiRequestHandler(
  getSavedGroupUploadValidator,
)(async (req) => ({
  upload: toApiSavedGroupUpload(
    await findRemoteSavedGroupUpload(
      req.context,
      req.params.id,
      req.params.version,
    ),
  ),
}));
