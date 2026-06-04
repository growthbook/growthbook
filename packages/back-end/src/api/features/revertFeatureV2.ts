import { revertFeatureV2Validator } from "shared/validators";
import { getApiFeatureObjV2 } from "back-end/src/services/features";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { revertFeatureCore } from "./revertFeature";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export const revertFeatureV2 = createApiRequestHandler(
  revertFeatureV2Validator,
)(async (req) => {
  const data = await revertFeatureCore(
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
