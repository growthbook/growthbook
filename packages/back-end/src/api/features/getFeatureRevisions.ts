import omit from "lodash/omit";
import {
  getFeatureRevisionsByStatus,
  FeatureRevisionModel,
} from "back-end/src/models/FeatureRevisionModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeatureRevisionsValidator } from "back-end/src/validators/openapi";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator
)(async (req) => {
  const limit = req.query.limit ?? 10;
  const offset = req.query.offset ?? 0;
  // Fetch paginated revisions from DB
  const pagedRevisions = await getFeatureRevisionsByStatus({
    context: req.context,
    organization: req.organization.id,
    featureId: req.params.id,
    limit,
    offset,
  });
  // Fetch total count for pagination fields
  const total = await FeatureRevisionModel.countDocuments({
    organization: req.organization.id,
    featureId: req.params.id,
  });
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
