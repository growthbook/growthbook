import { postConfigRevisionReopenValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionReopen = createApiRequestHandler(
  postConfigRevisionReopenValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  if (revision.status !== "discarded") {
    throw new BadRequestError("Only discarded revisions can be reopened");
  }

  // Authors can always reopen their own drafts; otherwise require edit perm.
  if (revision.authorId !== req.context.userId) {
    if (
      !getAdapter("config").canUpdate(
        req.context,
        config as Record<string, unknown>,
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  const reopened = await req.context.models.revisions.reopen(
    revision.id,
    req.context.userId,
  );

  await dispatchConfigRevisionEvent(req.context, reopened, {
    type: "reopened",
  });

  return { revision: await toApiConfigRevision(reopened, req.context) };
});
