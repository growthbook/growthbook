import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBanditQuery } from "back-end/src/enterprise/models/ContextualBanditQueryModel";

export const getContextualBanditQuery = createApiRequestHandler(
  contextualBanditQueryEndpoints.getContextualBanditQuery,
)(async (req) => {
  const doc = await req.context.models.contextualBanditQueries.getById(
    req.params.id,
  );
  if (!doc) return req.context.throwNotFoundError();
  return {
    contextualBanditQuery: await resolveOwnerEmail(
      toApiContextualBanditQuery(doc),
      req.context,
    ),
  };
});
