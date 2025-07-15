import { getFeatureRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  applyPagination,
} from "back-end/src/util/handler";
import { getFeatureRevisionsValidator } from "back-end/src/validators/openapi";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator
)(async (req) => {
  // Fetch all revisions for the feature (could optimize to fetch only needed slice if DB supports it)
  const allRevisions = await getFeatureRevisionsByStatus({
    context: req.context,
    organization: req.organization.id,
    featureId: req.params.id,
    limit: 1000, // fetch a large number, then paginate in-memory
  });
  const { filtered, returnFields } = applyPagination(allRevisions, req.query);
  return {
    revisions: filtered,
    ...returnFields,
  };
});
