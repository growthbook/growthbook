import { Revision } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ApiEventUser,
  EventUser,
  eventUserIdentity,
  eventUserToApiEventUser,
  revisionActor,
} from "shared/validators";

// What a revision event carries about its revision; the rest is a REST lookup.
function reference({
  id,
  version,
  status,
  title,
  authorId,
  author,
}: {
  id?: string;
  version?: number;
  status: string;
  title?: string;
  authorId: string;
  author?: EventUser;
}) {
  const apiAuthor = eventUserToApiEventUser(author);
  return {
    ...(id ? { id } : {}),
    ...(version !== undefined && { version }),
    status,
    ...(title ? { title } : {}),
    authorId,
    ...(apiAuthor && { author: apiAuthor }),
  };
}

export function revisionReference(revision: Revision) {
  return reference({
    ...revision,
    author: revision.authorId
      ? revisionActor(revision, revision.authorId)
      : undefined,
  });
}

export function featureRevisionReference(revision: FeatureRevisionInterface) {
  return reference({
    ...revision,
    authorId: eventUserIdentity(revision.createdBy) ?? "",
    author: revision.createdBy,
  });
}

export function webhookActor(user: EventUser): ApiEventUser {
  return eventUserToApiEventUser(user) ?? { type: "system" };
}
