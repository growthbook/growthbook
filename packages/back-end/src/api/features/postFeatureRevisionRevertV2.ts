import { postFeatureRevisionRevertV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { revertFeatureRevision } from "./postFeatureRevisionRevert";

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
  );
  return { revision: toApiRevisionV2(revision) };
});
