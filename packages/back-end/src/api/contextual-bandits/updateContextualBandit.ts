import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const updateContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.updateContextualBandit,
)(async (req) => {
  const model = req.context.models.contextualBandits;
  const updated = await model.updateById(
    req.params.id,
    await model.processApiUpdateBody(req.body),
  );
  return {
    contextualBandit: await resolveOwnerEmail(
      toApiContextualBandit(updated),
      req.context,
    ),
  };
});
