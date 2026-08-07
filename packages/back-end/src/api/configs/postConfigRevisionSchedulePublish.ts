import { postConfigRevisionSchedulePublishValidator } from "shared/validators";
import { scheduleRevisionPublish } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionSchedulePublish = createApiRequestHandler(
  postConfigRevisionSchedulePublishValidator,
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

  const updated = await scheduleRevisionPublish({
    context: req.context,
    type: "config",
    entity: config as unknown as Record<string, unknown>,
    revision,
    body: req.body,
    // A locked Config refuses NEW schedules while still allowing a pending one to
    // be cancelled — the only entity-specific arming precondition.
    assertArmable: () => assertConfigNotLocked(config),
  });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
