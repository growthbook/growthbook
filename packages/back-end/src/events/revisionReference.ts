import { Revision } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ApiEventUser,
  EventUser,
  eventUserIdentity,
  eventUserLegacyLabel,
  eventUserToApiEventUser,
  revisionActor,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { revisionScheduleApiFields } from "back-end/src/revisions/revisionScheduleApiFields";

// What every revision event carries about its revision: who wrote it and its
// review and schedule state. Each entity's dispatcher adds the content.
function reference({
  id,
  version,
  baseVersion,
  status,
  title,
  comment,
  dateCreated,
  dateUpdated,
  authorId,
  author,
}: {
  id?: string;
  version?: number;
  baseVersion?: number;
  status: string;
  title?: string;
  comment?: string;
  dateCreated: Date | string;
  dateUpdated: Date | string;
  authorId: string;
  author?: EventUser;
}) {
  const apiAuthor = eventUserToApiEventUser(author);
  return {
    ...(id ? { id } : {}),
    version: version ?? 0,
    baseVersion: baseVersion ?? 0,
    status,
    ...(title ? { title } : {}),
    comment: comment ?? "",
    dateCreated: new Date(dateCreated).toISOString(),
    dateUpdated: new Date(dateUpdated).toISOString(),
    authorId,
    ...(apiAuthor && { author: apiAuthor }),
  };
}

export async function revisionReference(context: Context, revision: Revision) {
  return {
    ...reference({
      ...revision,
      baseVersion: await context.models.revisions.getBaseVersion(revision),
      author: revision.authorId
        ? revisionActor(revision, revision.authorId)
        : undefined,
    }),
    ...revisionScheduleApiFields(revision),
  };
}

export function featureRevisionReference(revision: FeatureRevisionInterface) {
  const createdBy = eventUserLegacyLabel(revision.createdBy);
  const publishedBy = eventUserLegacyLabel(revision.publishedBy);
  return {
    ...reference({
      ...revision,
      authorId: eventUserIdentity(revision.createdBy) ?? "",
      author: revision.createdBy,
    }),
    ...revisionScheduleApiFields(revision),
    featureId: revision.featureId,
    date: new Date(revision.dateCreated).toISOString(),
    ...(createdBy && { createdBy }),
    ...(publishedBy && { publishedBy }),
  };
}

export function webhookActor(user: EventUser): ApiEventUser {
  return eventUserToApiEventUser(user) ?? { type: "system" };
}
