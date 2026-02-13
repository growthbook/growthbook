import lodash from "lodash";
import { getFeatureRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";

const { omit } = lodash;

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
  // Remove 'organization' field from each revision
  const cleaned = pagedRevisions.map((rev) => omit(rev, "organization"));
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  return {
    revisions: cleaned,
    limit,
    offset,
    count: cleaned.length,
    total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
});
