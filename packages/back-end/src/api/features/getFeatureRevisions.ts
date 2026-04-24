import { getFeatureRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
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
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator,
)(async (req) => {
  // getFeature enforces canReadSingleProjectResource and returns null for
  // unreadable projects.
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const { status, author } = req.query;

  const skipPagination = stringToBoolean(req.query.skipPagination?.toString());
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new Error(
      "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
    );
  }
  let limit: number;
  let offset: number;
  if (skipPagination) {
    limit = req.query.limit ?? 10;
    offset = req.query.offset ?? 0;
  } else {
    ({ limit, offset } = validatePagination(req.query));
  }

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
      skipPagination,
    }),
    countDocuments(req.organization.id, {
      featureId: req.params.id,
      status,
      author,
    }),
  ]);

  const revisions = pagedRevisions.map(revisionToApiInterface);
  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;
  const outLimit = skipPagination ? total : limit;
  const outOffset = skipPagination ? 0 : offset;
  return {
    revisions,
    limit: outLimit,
    offset: outOffset,
    count: revisions.length,
    total,
    hasMore,
    nextOffset,
  };
});
