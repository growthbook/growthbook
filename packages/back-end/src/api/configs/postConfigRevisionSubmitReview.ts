import { postConfigRevisionSubmitReviewValidator } from "shared/validators";
import { submitRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionSubmitReview = createApiRequestHandler(
  postConfigRevisionSubmitReviewValidator,
)(async (req) => {
  // Addressed by the entity's own key, so an entity the caller cannot read is a
  // 404 here even for a comment, which the internal controller — addressed by
  // revision id — would allow on the snapshot. Deliberate: closing the gap means
  // a permission-bypassing read on the key, and this direction fails closed.
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const { revision: result, autoPublished } = await submitRevisionReview({
    context: req.context,
    entityType: "config",
    entity: config as unknown as Record<string, unknown> & {
      project?: string;
      projects?: string[];
    },
    revision,
    decision: req.body.decision,
    comment: req.body.comment,
    skipAutoPublish: req.body.skipAutoPublish,
  });

  return {
    revision: await toApiConfigRevision(result, req.context),
    autoPublished,
  };
});
