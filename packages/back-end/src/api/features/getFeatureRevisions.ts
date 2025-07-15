import { getFeatureRevisionsByStatus } from "back-end/src/models/FeatureRevisionModel";
import {
  createApiRequestHandler,
  applyPagination,
} from "back-end/src/util/handler";
import { getFeatureRevisionsValidator } from "back-end/src/validators/openapi";

export const getFeatureRevisions = createApiRequestHandler(
  getFeatureRevisionsValidator
)(async (req) => {
  const allRevisions = await getFeatureRevisionsByStatus({
    context: req.context,
    organization: req.organization.id,
    featureId: req.params.id,
    limit: 10000, // fetch a large number, then paginate in-memory
  });
  const { filtered, returnFields } = applyPagination(allRevisions, req.query);
  return {
    revisions: filtered,
    ...returnFields,
  };
});
