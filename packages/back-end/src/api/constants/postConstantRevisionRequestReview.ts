import { postConstantRevisionRequestReviewValidator } from "shared/validators";
import { requestRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRequestReview = createApiRequestHandler(
  postConstantRevisionRequestReviewValidator,
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

  const updated = await requestRevisionReview({
    context: req.context,
    entityType: "constant",
    entity: constant as unknown as Record<string, unknown>,
    revision,
    autoPublishOnApproval: req.body.autoPublishOnApproval,
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
