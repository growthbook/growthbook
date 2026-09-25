import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const createContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.createContextualBandit,
)(async (req) => {
  const model = req.context.models.contextualBandits;
  const created = await model.create(
    await model.processApiCreateBody(req.body),
  );
  return {
    contextualBandit: await resolveOwnerEmail(
      toApiContextualBandit(created),
      req.context,
    ),
  };
});
