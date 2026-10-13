import { Revision } from "shared/enterprise";
import {
  ApiEventUser,
  EventUser,
  eventUserToApiEventUser,
  revisionActor,
} from "shared/validators";

// What a revision event carries about its revision; the rest is a REST lookup.
export function revisionReference(revision: Revision) {
  const author = revision.authorId
    ? eventUserToApiEventUser(revisionActor(revision, revision.authorId))
    : undefined;
  return {
    id: revision.id,
    ...(revision.version !== undefined && { version: revision.version }),
    status: revision.status,
    ...(revision.title ? { title: revision.title } : {}),
    authorId: revision.authorId,
    ...(author && { author }),
  };
}

export function webhookActor(user: EventUser): ApiEventUser {
  return eventUserToApiEventUser(user) ?? { type: "system" };
}
