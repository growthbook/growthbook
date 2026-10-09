import { listSavedGroupUploadsValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { listRemoteSavedGroupUploads } from "back-end/src/services/remoteSavedGroups";

export const listSavedGroupUploads = createApiRequestHandler(
  listSavedGroupUploadsValidator,
)(async (req) => {
  const { limit, offset } = validatePagination(req.query);
  const { uploads, total } = await listRemoteSavedGroupUploads(
    req.context,
    req.params.id,
    { limit, offset },
  );
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  return {
    uploads,
    limit,
    offset,
    count: uploads.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
