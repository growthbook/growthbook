import { toggleFeatureV2Validator } from "shared/validators";
import { getApiFeatureObjV2 } from "back-end/src/services/features";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toggleFeatureCore } from "./toggleFeature";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export const toggleFeatureV2 = createApiRequestHandler(
  toggleFeatureV2Validator,
)(async (req) => {
  const data = await toggleFeatureCore(
    req.context,
    req.organization,
    req.eventAudit,
    req.params,
    req.body,
    req.audit,
    canUseRestApiBypassSetting(req),
  );
  return {
    feature: await resolveOwnerEmail(getApiFeatureObjV2(data), req.context),
  };
});
