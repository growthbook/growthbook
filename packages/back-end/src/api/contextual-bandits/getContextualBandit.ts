import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const getContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBandit,
)(async (req) => {
  const cb = await req.context.models.contextualBandits.getById(req.params.id);
  if (!cb) return req.context.throwNotFoundError();
  return {
    contextualBandit: await resolveOwnerEmail(
      toApiContextualBandit(cb),
      req.context,
    ),
  };
});
