import { getFeatureRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { NotFoundError } from "back-end/src/util/errors";
import { revisionToApiInterface } from "back-end/src/services/features";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator,
)(async (req) => {
  // Load the feature first — getFeature enforces canReadSingleProjectResource
  // and returns null for features in projects the caller cannot read.
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

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
