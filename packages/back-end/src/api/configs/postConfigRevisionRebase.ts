import { postConfigRevisionRebaseValidator } from "shared/validators";
import { rebaseRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRebase = createApiRequestHandler(
  postConfigRevisionRebaseValidator,
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

  const updated = await rebaseRevision({
    context: req.context,
    entityType: "config",
    entity: config as unknown as Record<string, unknown>,
    revision,
    strategies: req.body.conflictResolutions ?? {},
    customValues: req.body.customValues,
  });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
