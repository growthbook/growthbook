import { getFeatureRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import { revisionToApiInterface } from "back-end/src/services/features";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator,
)(async (req) => {
  const { limit, offset } = validatePagination(req.query);
  // Fetch paginated revisions from DB
  const pagedRevisions = await getFeatureRevisionsByStatus({
    context: req.context,
    organization: req.organization.id,
    featureId: req.params.id,
    limit,
    offset,
    sort: "asc",
  });
  // Fetch total count for pagination fields
  const total = await countDocuments(req.organization.id, req.params.id);
  const revisions = pagedRevisions.map(revisionToApiInterface);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  return {
    revisions,
    limit,
    offset,
    count: revisions.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
