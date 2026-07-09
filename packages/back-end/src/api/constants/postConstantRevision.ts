import { postConstantRevisionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import {
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevision = createApiRequestHandler(
  postConstantRevisionValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  if (!req.context.permissions.canUpdateConstant(constant, constant)) {
    req.context.permissions.throwPermissionError();
  }

  await ensureLiveRevisionExists(
    req.context,
    "constant",
    constant as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // forceCreate=true so every POST yields a fresh draft (and the caller's
  // title/comment aren't silently dropped onto an aliased existing draft).
  const revision = await createOrUpdateRevision(
    req.context,
    "constant",
    constant as unknown as Record<string, unknown> & { id: string },
    [],
    { forceCreate: true, title: req.body.title, comment: req.body.comment },
  );

  await dispatchConstantRevisionEvent(req.context, revision, {
    type: "created",
  });

  return { revision: await toApiConstantRevision(revision, req.context) };
});
