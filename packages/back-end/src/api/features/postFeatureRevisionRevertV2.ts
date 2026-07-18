import { postFeatureRevisionRevertV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { revertFeatureRevision } from "./postFeatureRevisionRevert";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export const postFeatureRevisionRevertV2 = createApiRequestHandler(
  postFeatureRevisionRevertV2Validator,
)(async (req) => {
  const { revision } = await revertFeatureRevision(
    req.context,
    req.organization,
    req.eventAudit,
    req.params,
    req.body,
    req.audit,
    canUseRestApiBypassSetting(req),
  );
  return { revision: toApiRevisionV2(revision) };
});
