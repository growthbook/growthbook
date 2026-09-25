import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { executeContextualBanditVariationChange } from "back-end/src/enterprise/services/contextualBandits";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const updateContextualBanditVariations = createApiRequestHandler(
  contextualBanditEndpoints.updateContextualBanditVariations,
)(async (req) => {
  const cb = await req.context.models.contextualBandits.getById(req.params.id);
  if (!cb) {
    return req.context.throwNotFoundError(
      `Contextual Bandit ${req.params.id} not found or not accessible`,
    );
  }
  if (!req.context.permissions.canUpdateContextualBandit(cb, cb)) {
    req.context.permissions.throwPermissionError();
  }
  const { updated, featureDraftPublishFailures } =
    await executeContextualBanditVariationChange(req.context, cb, {
      addVariations: req.body.addVariations,
      removeVariationIds: req.body.removeVariationIds,
      updateVariations: req.body.updateVariations,
    });
  return {
    contextualBandit: toApiContextualBandit(updated),
    ...(featureDraftPublishFailures.length > 0
      ? { featureDraftPublishFailures }
      : {}),
  };
});
