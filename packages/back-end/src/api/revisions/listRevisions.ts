import omit from "lodash/omit";
import { listRevisionsValidator } from "shared/validators";
import {
  getFeatureRevisionsByStatus,
  countDocuments,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";

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

    const cleaned = revisions.map((rev) => omit(rev, "organization"));
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
  },
);
