import omit from "lodash/omit";
import { getFeatureRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator,
)(async (req) => {
  const { limit, offset } = validatePagination(req.query);
  const { status, author } = req.query;

  const [pagedRevisions, total] = await Promise.all([
    getFeatureRevisionsByStatus({
      context: req.context,
      organization: req.organization.id,
      featureId: req.params.id,
      status,
      author,
      limit,
      offset,
      sort: "desc",
    }),
    countDocuments(req.organization.id, {
      featureId: req.params.id,
      status,
      author,
    }),
  ]);

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
