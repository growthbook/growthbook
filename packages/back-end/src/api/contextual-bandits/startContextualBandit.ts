import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { executeContextualBanditStart } from "back-end/src/services/contextualBanditChanges";
import { getContextualBanditLinkedFeatureInfo } from "back-end/src/enterprise/services/contextualBandits";
import { toApiContextualBandit } from "back-end/src/enterprise/models/ContextualBanditModel";

export const startContextualBandit = createApiRequestHandler(
  contextualBanditEndpoints.startContextualBandit,
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
  const linkedFeatures = await getContextualBanditLinkedFeatureInfo(
    req.context,
    cb,
  );
  if (linkedFeatures.length === 0) {
    throw new Error(
      "Link at least one Feature Flag before starting this contextual bandit",
    );
  }
  const { updated } = await executeContextualBanditStart(req.context, cb);
  return { contextualBandit: toApiContextualBandit(updated) };
});
