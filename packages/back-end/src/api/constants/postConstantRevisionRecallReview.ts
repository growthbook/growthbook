import { postConstantRevisionRecallReviewValidator } from "shared/validators";
import { recallRevisionReview } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRecallReview = createApiRequestHandler(
  postConstantRevisionRecallReviewValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find Constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  const recalled = await recallRevisionReview({
    context: req.context,
    type: "constant",
    revision,
  });

  return { revision: await toApiConstantRevision(recalled, req.context) };
});
