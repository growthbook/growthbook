import {
  getFeatureRevisionsV2Validator,
  ACTIVE_DRAFT_STATUSES,
} from "shared/validators";
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
    {
      ...req.query,
      // Default to active drafts only; callers must opt in to see terminal statuses
      status: req.query.status ?? [...ACTIVE_DRAFT_STATUSES],
    },
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
