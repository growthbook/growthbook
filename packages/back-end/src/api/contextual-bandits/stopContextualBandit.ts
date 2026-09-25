import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { executeContextualBanditStop } from "back-end/src/services/contextualBanditChanges";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const stopContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.stopContextualBandit,
)(async (req) => {
  const cb = await req.context.models.contextualBandits.getById(req.params.id);
  if (!cb) {
    return req.context.throwNotFoundError(
      `Contextual Bandit ${req.params.id} not found or not accessible`,
    );
  }
  const envs = req.context.org.settings?.environments?.map((e) => e.id) ?? [];
  if (!req.context.permissions.canRunContextualBandit(cb, envs)) {
    req.context.permissions.throwPermissionError();
  }
  const { updated } = await executeContextualBanditStop(req.context, cb, {
    allowAlreadyStopped: true,
  });
  return { contextualBandit: toApiContextualBandit(updated) };
});
