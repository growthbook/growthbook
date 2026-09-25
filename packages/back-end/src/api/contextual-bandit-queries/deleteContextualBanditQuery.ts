import { contextualBanditQueryEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteContextualBanditQuery = createApiRequestHandler(
  contextualBanditQueryEndpoints.deleteContextualBanditQuery,
)(async (req) => {
  await req.context.models.contextualBanditQueries.deleteById(req.params.id);
  return { deletedId: req.params.id };
});
