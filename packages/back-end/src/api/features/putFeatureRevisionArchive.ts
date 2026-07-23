import type { OrganizationInterface } from "shared/types/organization";
import { putFeatureRevisionArchiveValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
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

  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const { revision, created } = await resolveOrCreateRevision(
    context,
    organization.id,
    feature,
    params.version,
    { title: body.revisionTitle, comment: body.revisionComment },
  );

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
      resetReviewOnChange({
        feature,
        changedEnvironments: [],
        defaultValueChanged: false,
        settings: organization.settings,
      }),
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
