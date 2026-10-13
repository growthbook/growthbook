import { Revision } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ApiEventUser,
  EventUser,
  eventUserIdentity,
  eventUserToApiEventUser,
  revisionActor,
} from "shared/validators";
import { revisionScheduleApiFields } from "back-end/src/revisions/revisionScheduleApiFields";

// What a revision event carries about its revision: who wrote it and its review
// and schedule state. The content is a REST lookup.
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
  return {
    ...reference({
      ...revision,
      author: revision.authorId
        ? revisionActor(revision, revision.authorId)
        : undefined,
    }),
    ...revisionScheduleApiFields(revision),
  };
}

export function featureRevisionReference(revision: FeatureRevisionInterface) {
  return {
    ...reference({
      ...revision,
      authorId: eventUserIdentity(revision.createdBy) ?? "",
      author: revision.createdBy,
    }),
    ...(revision.baseVersion !== undefined && {
      baseVersion: revision.baseVersion,
    }),
    ...revisionScheduleApiFields(revision),
  };
}

export function webhookActor(user: EventUser): ApiEventUser {
  return eventUserToApiEventUser(user) ?? { type: "system" };
}
