import { postConstantRevisionRebaseValidator } from "shared/validators";
import { rebaseRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRebase = createApiRequestHandler(
  postConstantRevisionRebaseValidator,
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

  const updated = await rebaseRevision({
    context: req.context,
    entityType: "constant",
    entity: constant as unknown as Record<string, unknown>,
    revision,
    // No customValues: Constants offer no `union`, having no list to merge.
    strategies: req.body.conflictResolutions ?? {},
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
