import { postFeatureRevisionRebaseV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { rebaseFeatureRevision } from "./postFeatureRevisionRebase";

export const postFeatureRevisionRebaseV2 = createApiRequestHandler(
  postFeatureRevisionRebaseV2Validator,
)(async (req) => {
  const { revision } = await rebaseFeatureRevision(
    req.context,
    req.organization,
    req.params,
    req.body,
    req.audit,
  );
  return { revision: toApiRevisionV2(revision) };
});
