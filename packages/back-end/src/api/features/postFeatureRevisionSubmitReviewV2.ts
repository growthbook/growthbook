import { postFeatureRevisionSubmitReviewV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { submitRevisionReview } from "./postFeatureRevisionSubmitReview";

export const postFeatureRevisionSubmitReviewV2 = createApiRequestHandler(
  postFeatureRevisionSubmitReviewV2Validator,
)(async (req) => {
  const { revision, autoPublished } = await submitRevisionReview(req);
  return { revision: toApiRevisionV2(revision), autoPublished };
});
