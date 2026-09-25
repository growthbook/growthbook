import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBanditQuery } from "back-end/src/enterprise/models/ContextualBanditQueryModel";

export const createContextualBanditQuery = createApiRequestHandler(
  contextualBanditQueryEndpoints.createContextualBanditQuery,
)(async (req) => {
  const created = await req.context.models.contextualBanditQueries.create({
    ...req.body,
    owner: req.body.owner ?? "",
  });
  return {
    contextualBanditQuery: await resolveOwnerEmail(
      toApiContextualBanditQuery(created),
      req.context,
    ),
  };
});
