import { postConstantRevisionSubmitReviewValidator } from "shared/validators";
import { submitRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionSubmitReview = createApiRequestHandler(
  postConstantRevisionSubmitReviewValidator,
)(async (req) => {
  // Addressed by the entity's own key, so an entity the caller cannot read is a
  // 404 here even for a comment, which the internal controller — addressed by
  // revision id — would allow on the snapshot. Deliberate: closing the gap means
  // a permission-bypassing read on the key, and this direction fails closed.
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find Constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  const { revision: result, autoPublished } = await submitRevisionReview({
    context: req.context,
    entityType: "constant",
    entity: constant as unknown as Record<string, unknown> & {
      project?: string;
      projects?: string[];
    },
    revision,
    decision: req.body.decision,
    comment: req.body.comment,
    skipAutoPublish: req.body.skipAutoPublish,
  });

  return {
    revision: await toApiConstantRevision(result, req.context),
    autoPublished,
  };
});
