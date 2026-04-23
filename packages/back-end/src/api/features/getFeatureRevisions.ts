import { getFeatureRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { NotFoundError } from "back-end/src/util/errors";
import { toApiRevision } from "back-end/src/services/features";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";

export async function loadFeatureRevisionsPage(
  context: ApiReqContext,
  organizationId: string,
  featureId: string,
  query: {
    status?: string;
    author?: string;
    skipPagination?: string | boolean;
    limit?: number;
    offset?: number;
  },
) {
  // getFeature enforces canReadSingleProjectResource and returns null for
  // unreadable projects.
  const feature = await getFeature(context, featureId);
  if (!feature) throw new NotFoundError("Could not find feature");

  const { status, author } = query;

  const skipPagination = stringToBoolean(query.skipPagination?.toString());
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new Error(
      "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
    );
  }
  let limit: number;
  let offset: number;
  if (skipPagination) {
    limit = query.limit ?? 10;
    offset = query.offset ?? 0;
  } else {
    ({ limit, offset } = validatePagination(query));
  }

  const [pagedRevisions, total] = await Promise.all([
    getFeatureRevisionsByStatus({
      context,
      organization: organizationId,
      featureId,
      status: status as Parameters<
        typeof getFeatureRevisionsByStatus
      >[0]["status"],
      author,
      limit,
      offset,
      sort: "desc",
      skipPagination,
    }),
    countDocuments(organizationId, {
      featureId,
      status: status as NonNullable<
        Parameters<typeof countDocuments>[1]
      >["status"],
      author,
    }),
  ]);

  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;
  const outLimit = skipPagination ? total : limit;
  const outOffset = skipPagination ? 0 : offset;

  return {
    feature,
    pagedRevisions,
    total,
    outLimit,
    outOffset,
    hasMore,
    nextOffset,
  };
}

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator,
)(async (req) => {
  const r = await loadFeatureRevisionsPage(
    req.context,
    req.organization.id,
    req.params.id,
    req.query,
  );
  const revisions = r.pagedRevisions.map((rev) =>
    toApiRevision(rev, req.context, r.feature),
  );
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
