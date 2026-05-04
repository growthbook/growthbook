import { listRevisionsV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { loadRevisionsPage } from "./listRevisions";

export const listRevisionsV2 = createApiRequestHandler(
  listRevisionsV2Validator,
)(async (req) => {
  const r = await loadRevisionsPage(
    req.context,
    req.organization.id,
    req.query,
  );
  if (r.empty) return r.response;
  const mapped = r.revisions.map((rev) => toApiRevisionV2(rev));
  return {
    revisions: mapped,
    limit: r.outLimit,
    offset: r.outOffset,
    count: mapped.length,
    total: r.total,
    hasMore: r.hasMore,
    nextOffset: r.nextOffset,
  };
});
