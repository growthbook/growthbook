import { postConfigRevisionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import {
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevision = createApiRequestHandler(
  postConfigRevisionValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  if (!req.context.permissions.canRevisionAction("config", "draft", config)) {
    req.context.permissions.throwPermissionError();
  }

  await ensureLiveRevisionExists(
    req.context,
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // forceCreate=true so every POST yields a fresh draft (and the caller's
  // title/comment aren't silently dropped onto an aliased existing draft).
  const revision = await createOrUpdateRevision(
    req.context,
    "config",
    config as unknown as Record<string, unknown> & { id: string },
    [],
    { forceCreate: true, title: req.body.title, comment: req.body.comment },
  );

  await dispatchConfigRevisionEvent(req.context, revision, {
    type: "created",
  });

  return { revision: await toApiConfigRevision(revision, req.context) };
});
