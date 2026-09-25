import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBanditQuery } from "back-end/src/enterprise/models/ContextualBanditQueryModel";

export const updateContextualBanditQuery = createApiRequestHandler(
  contextualBanditQueryEndpoints.updateContextualBanditQuery,
)(async (req) => {
  const updated = await req.context.models.contextualBanditQueries.updateById(
    req.params.id,
    req.body,
  );
  return {
    contextualBanditQuery: await resolveOwnerEmail(
      toApiContextualBanditQuery(updated),
      req.context,
    ),
  };
});
