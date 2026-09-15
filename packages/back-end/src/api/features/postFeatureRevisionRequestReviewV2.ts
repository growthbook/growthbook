import { postFeatureRevisionRequestReviewV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requestReview } from "./postFeatureRevisionRequestReview";

export const postFeatureRevisionRequestReviewV2 = createApiRequestHandler(
  postFeatureRevisionRequestReviewV2Validator,
)(async (req) => {
  const { revision } = await requestReview(req);
  return { revision: toApiRevisionV2(revision) };
});
