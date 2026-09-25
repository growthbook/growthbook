import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listContextualBandits = createApiRequestHandler(
  contextualBanditEndpoints.listContextualBandits,
)(async (req) => {
  return {
    contextualBandits: await req.context.models.contextualBandits.listForApi(
      req.query,
    ),
  };
});
