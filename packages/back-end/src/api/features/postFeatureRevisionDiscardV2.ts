import { postFeatureRevisionDiscardV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { discardFeatureRevision } from "./postFeatureRevisionDiscard";

export const postFeatureRevisionDiscardV2 = createApiRequestHandler(
  postFeatureRevisionDiscardV2Validator,
)(async (req) => {
  const { revision } = await discardFeatureRevision(req);
  return { revision: toApiRevisionV2(revision) };
});
