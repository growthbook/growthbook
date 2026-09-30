import type { OrganizationInterface } from "shared/types/organization";
import { putFeatureRevisionArchiveValidator } from "shared/validators";
import {
  canWriteArchiveIntoDraft,
  canStageArchiveDraft,
} from "back-end/src/revisions/landAuthority";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export async function archiveRevision(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new" },
  body: { archived: boolean; revisionTitle?: string; revisionComment?: string },
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !canStageArchiveDraft({
      permissions: context.permissions,
      model: "feature",
      entity: feature,
      archived: body.archived,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  const { revision, created } = await resolveOrCreateRevision(
    context,
    organization.id,
    feature,
    params.version,
    { title: body.revisionTitle, comment: body.revisionComment },
  );

  // Writing `archived` into a PINNED revision is a write into someone else's
  // draft: it makes that draft delete-class, so its author — a publisher without
  // delete — can no longer publish their own work.
  if (
    !created &&
    !canWriteArchiveIntoDraft({
      permissions: context.permissions,
      model: "feature",
      entity: feature,
      revision: {
        authorId:
          revision.createdBy && "id" in revision.createdBy
            ? revision.createdBy.id
            : undefined,
        contributors: revision.contributors,
      },
      userId: context.userId,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const currentArchived = revision.archived ?? feature.archived ?? false;
    if (currentArchived === body.archived) {
      await discardIfJustCreated(context, revision, created);
      return { feature, revision };
    }

    await updateRevision(
      context,
      feature,
      revision,
      { archived: body.archived },
      {
        user: context.auditUser,
        action: body.archived ? "archive feature" : "unarchive feature",
        subject: "",
        value: JSON.stringify({ archived: body.archived }),
      },
    );

    const updated = await getRevision({
      context,
      organization: organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(context, feature, finalRevision, "archive", {
      auditDetails: { archived: body.archived },
    });

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const putFeatureRevisionArchive = createApiRequestHandler(
  putFeatureRevisionArchiveValidator,
)(async (req) => {
  const { feature, revision } = await archiveRevision(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
