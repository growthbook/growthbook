import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";

export const refreshContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.refreshContextualBandit,
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
  return runContextualBanditSnapshot(req.context, cb, {
    triggeredBy: "manual",
  });
});
