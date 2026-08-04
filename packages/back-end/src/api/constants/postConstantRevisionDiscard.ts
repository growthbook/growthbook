import { postConstantRevisionDiscardValidator } from "shared/validators";
import { discardRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionDiscard = createApiRequestHandler(
  postConstantRevisionDiscardValidator,
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

  const closed = await discardRevision({
    context: req.context,
    entityType: "constant",
    entity: constant,
    revision,
    reason: req.body.reason,
  });

  return { revision: await toApiConstantRevision(closed, req.context) };
});
