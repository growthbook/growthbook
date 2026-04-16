import { listRevisionsValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
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
import { revisionToApiInterface } from "back-end/src/services/features";
import { BadRequestError } from "back-end/src/util/errors";

const emptyListResponse = (limit: number, offset: number) => ({
  revisions: [],
  limit,
  offset,
  count: 0,
  total: 0,
  hasMore: false,
  nextOffset: null,
});

export const listRevisions = createApiRequestHandler(listRevisionsValidator)(
  async (req) => {
    const { featureId, status, author } = req.query;

    const mine = stringToBoolean(req.query.mine?.toString());
    if (mine && author) {
      throw new BadRequestError(
        "`mine` and `author` are mutually exclusive. Pass one or the other.",
      );
    }
    if (mine && !req.context.userId) {
      throw new BadRequestError(
        "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
      );
    }
    const involvedUserId = mine ? req.context.userId : undefined;

    const skipPagination = stringToBoolean(
      req.query.skipPagination?.toString(),
    );
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

    // ACL: load the single feature (return [] if unreadable to avoid leaking
    // existence), or restrict to readable projects when featureId is absent.
    let featureIds: string[] | undefined;
    if (featureId) {
      const feature = await getFeature(req.context, featureId);
      if (!feature) return emptyListResponse(limit, offset);
    } else {
      const readableProjects =
        req.context.permissions.getProjectsWithPermission("readData");
      if (readableProjects !== null) {
        if (readableProjects.length === 0) {
          return emptyListResponse(limit, offset);
        }
        const scopedFeatures = await getAllFeatures(req.context, {
          projects: readableProjects,
          includeArchived: true,
        });
        featureIds = scopedFeatures.map((f) => f.id);
        if (featureIds.length === 0) {
          return emptyListResponse(limit, offset);
        }
      }
    }

    const [revisions, total] = await Promise.all([
      getFeatureRevisionsByStatus({
        context: req.context,
        organization: req.organization.id,
        featureId,
        featureIds,
        status,
        author,
        involvedUserId,
        limit,
        offset,
        sort: "desc",
        skipPagination,
      }),
      countDocuments(req.organization.id, {
        featureId,
        featureIds,
        status,
        author,
        involvedUserId,
      }),
    ]);

    const mapped = revisions.map(revisionToApiInterface);
    const hasMore = skipPagination ? false : offset + limit < total;
    const nextOffset = hasMore ? offset + limit : null;
    const outLimit = skipPagination ? total : limit;
    const outOffset = skipPagination ? 0 : offset;
    return {
      revisions: mapped,
      limit: outLimit,
      offset: outOffset,
      count: mapped.length,
      total,
      hasMore,
      nextOffset,
    };
  },
);
