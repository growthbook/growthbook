import { getContextualBanditLinkedFeaturesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { getContextualBanditLinkedFeatureInfo } from "back-end/src/enterprise/services/contextualBandits";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditLinkedFeatures = createApiRequestHandler(
  getContextualBanditLinkedFeaturesValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );

  const linkedFeatures = await getContextualBanditLinkedFeatureInfo(
    req.context,
    contextualBandit,
  );

  return {
    linkedFeatures,
    environments: getEnvironmentIdsFromOrg(req.context.org),
  };
});
