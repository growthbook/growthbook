import { listCustomHookHistoryValidator } from "shared/validators";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { getCustomHookVersions } from "back-end/src/services/customHookHistory";
import { assertCustomHooksAvailable } from "./validations";

export const listCustomHookHistory = createApiRequestHandler(
  listCustomHookHistoryValidator,
)(async (req) => {
  assertCustomHooksAvailable(req.context);

  const { limit, offset } = validatePagination(req.query);

  const { versions, total } = await getCustomHookVersions(
    req.context,
    req.params.id,
    { limit, offset },
  );

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    versions,
    limit,
    offset,
    count: versions.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
