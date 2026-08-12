import {
  listRevisionsValidator,
  parseRevisionStatusFilter,
} from "shared/validators";
import { stringToBoolean } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import { getAllFeatures, getFeature } from "back-end/src/models/FeatureModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import { toApiRevision } from "back-end/src/services/features";
import { BadRequestError } from "back-end/src/util/errors";

export const emptyListResponse = (limit: number, offset: number) => ({
  empty: true as const,
  response: {
    revisions: [] as never[],
    limit,
    offset,
    count: 0,
    total: 0,
    hasMore: false,
    nextOffset: null,
  },
});

export async function loadRevisionsPage(
  context: ApiReqContext,
  organizationId: string,
  query: {
    featureId?: string;
    status?: string | string[];
    author?: string;
    mine?: string | boolean;
    archived?: string | boolean;
    skipPagination?: string | boolean;
    limit?: number;
    offset?: number;
  },
) {
  const { featureId, author } = query;
  const status = parseRevisionStatusFilter(query.status);
  // Mirrors includeArchived: false (default) excludes archived features;
  // true includes them alongside non-archived ones.
  const includeArchived = stringToBoolean(query.archived?.toString()) ?? false;

  const mine = stringToBoolean(query.mine?.toString());
  if (mine && author) {
    throw new BadRequestError(
      "`mine` and `author` are mutually exclusive. Pass one or the other.",
    );
  }
  if (mine && !context.userId) {
    throw new BadRequestError(
      "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
    );
  }
  const involvedUserId = mine ? context.userId : undefined;

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

  let featureIds: string[] | undefined;
  let singleFeature: Awaited<ReturnType<typeof getFeature>> | undefined;
  if (featureId) {
    singleFeature = await getFeature(context, featureId);
    if (!singleFeature) return emptyListResponse(limit, offset);
    // Apply the archived filter consistently with the no-featureId path.
    // When archived=false (default), exclude revisions for archived features
    // even when featureId is given explicitly.
    if (singleFeature.archived && !includeArchived)
      return emptyListResponse(limit, offset);
  } else {
    const readableProjects =
      context.permissions.getProjectsWithPermission("readData");
    if (readableProjects !== null) {
      if (readableProjects.length === 0) {
        return emptyListResponse(limit, offset);
      }
      const scopedFeatures = await getAllFeatures(context, {
        projects: readableProjects,
        includeArchived,
      });
      featureIds = scopedFeatures.map((f) => f.id);
      if (featureIds.length === 0) {
        return emptyListResponse(limit, offset);
      }
    }
  }

  const [revisions, total] = await Promise.all([
    getFeatureRevisionsByStatus({
      context,
      organization: organizationId,
      featureId,
      featureIds,
      status: status as Parameters<
        typeof getFeatureRevisionsByStatus
      >[0]["status"],
      author,
      involvedUserId,
      limit,
      offset,
      sort: "desc",
      skipPagination,
    }),
    countDocuments(organizationId, {
      featureId,
      featureIds,
      status: status as NonNullable<
        Parameters<typeof countDocuments>[1]
      >["status"],
      author,
      involvedUserId,
    }),
  ]);

  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;
  const outLimit = skipPagination ? total : limit;
  const outOffset = skipPagination ? 0 : offset;

  return {
    empty: false as const,
    revisions,
    singleFeature,
    total,
    outLimit,
    outOffset,
    hasMore,
    nextOffset,
  };
}

export const listRevisions = createApiRequestHandler(listRevisionsValidator)(
  async (req) => {
    const r = await loadRevisionsPage(
      req.context,
      req.organization.id,
      { ...req.query, archived: true }, // v1 always included archived features
    );
    if (r.empty) return r.response;
    const mapped = r.revisions.map((rev) =>
      toApiRevision(rev, req.context, r.singleFeature),
    );
    return {
      revisions: mapped,
      limit: r.outLimit,
      offset: r.outOffset,
      count: mapped.length,
      total: r.total,
      hasMore: r.hasMore,
      nextOffset: r.nextOffset,
    };
  },
);
