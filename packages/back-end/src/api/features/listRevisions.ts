import { listRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { revisionToApiInterface } from "back-end/src/services/features";

export const listRevisions = createApiRequestHandler(listRevisionsValidator)(
  async (req) => {
    const { limit, offset } = validatePagination(req.query);
    const { featureId, status, author } = req.query;

    const [revisions, total] = await Promise.all([
      getFeatureRevisionsByStatus({
        context: req.context,
        organization: req.organization.id,
        featureId,
        status,
        author,
        limit,
        offset,
        sort: "desc",
      }),
      countDocuments(req.organization.id, {
        featureId,
        status,
        author,
      }),
    ]);

    const mapped = revisions.map(revisionToApiInterface);
    const nextOffset = offset + limit;
    const hasMore = nextOffset < total;
    return {
      revisions: mapped,
      limit,
      offset,
      count: mapped.length,
      total,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    };
  },
);
