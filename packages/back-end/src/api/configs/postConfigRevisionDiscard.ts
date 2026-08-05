import { postConfigRevisionDiscardValidator } from "shared/validators";
import { discardEntityRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionDiscard = createApiRequestHandler(
  postConfigRevisionDiscardValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const closed = await discardEntityRevision({
    context: req.context,
    entityType: "config",
    revision,
    reason: req.body.reason,
  });

  return { revision: await toApiConfigRevision(closed, req.context) };
});
