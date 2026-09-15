import { postConfigRevisionReopenValidator } from "shared/validators";
import { reopenRevision } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionReopen = createApiRequestHandler(
  postConfigRevisionReopenValidator,
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

  const reopened = await reopenRevision({
    context: req.context,
    type: "config",
    revision,
  });

  return { revision: await toApiConfigRevision(reopened, req.context) };
});
