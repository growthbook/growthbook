import { postFeatureRevisionSubmitReviewV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { submitRevisionReview } from "./postFeatureRevisionSubmitReview";
import { maybeAutoPublishFeatureRevision } from "./autoPublishOnApproval";

export const postFeatureRevisionSubmitReviewV2 = createApiRequestHandler(
  postFeatureRevisionSubmitReviewV2Validator,
)(async (req) => {
  const { feature, revision } = await submitRevisionReview(req);
  const finalRevision =
    req.body.action === "approve"
      ? await maybeAutoPublishFeatureRevision(req.context, feature, revision)
      : revision;
  return { revision: toApiRevisionV2(finalRevision) };
});
