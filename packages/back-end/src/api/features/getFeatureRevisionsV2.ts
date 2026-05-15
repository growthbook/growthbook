import { getFeatureRevisionsV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadFeatureRevisionsPage } from "./getFeatureRevisions";

export const getFeatureRevisionsV2 = createApiRequestHandler(
  getFeatureRevisionsV2Validator,
)(async (req) => {
  const r = await loadFeatureRevisionsPage(
    req.context,
    req.organization.id,
    req.params.id,
    req.query,
  );
  const revisions = r.pagedRevisions.map((rev) => toApiRevisionV2(rev));
  return {
    revisions,
    limit: r.outLimit,
    offset: r.outOffset,
    count: revisions.length,
    total: r.total,
    hasMore: r.hasMore,
    nextOffset: r.nextOffset,
  };
});
