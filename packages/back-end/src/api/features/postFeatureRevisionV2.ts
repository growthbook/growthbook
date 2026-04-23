import { postFeatureRevisionV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { createFeatureDraft } from "./postFeatureRevision";

export const postFeatureRevisionV2 = createApiRequestHandler(
  postFeatureRevisionV2Validator,
)(async (req) => {
  const { revision } = await createFeatureDraft(req);
  return { revision: toApiRevisionV2(revision) };
});
