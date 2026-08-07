import { postConstantRevisionSchedulePublishValidator } from "shared/validators";
import { scheduleRevisionPublish } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionSchedulePublish = createApiRequestHandler(
  postConstantRevisionSchedulePublishValidator,
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

  // No `assertArmable`: the lock precondition is a Config feature, and nothing
  // else gates arming for this entity.
  const updated = await scheduleRevisionPublish({
    context: req.context,
    type: "constant",
    entity: constant as unknown as Record<string, unknown>,
    revision,
    body: req.body,
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
