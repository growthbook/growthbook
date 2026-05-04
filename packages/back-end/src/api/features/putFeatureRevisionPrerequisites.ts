import type { OrganizationInterface } from "shared/types/organization";
import type { FeaturePrerequisite } from "shared/types/feature";
import { putFeatureRevisionPrerequisitesValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { NotFoundError, BadRequestError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  discardIfJustCreated,
  isDraftStatus,
  validatePrerequisiteConditions,
  validatePrerequisiteReferences,
  resolveOrCreateRevision,
} from "./validations";

export async function setRevisionPrerequisites(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new" },
  body: {
    prerequisites: FeaturePrerequisite[];
    revisionTitle?: string;
    revisionComment?: string;
  },
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  validatePrerequisiteConditions(body.prerequisites);

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

    await validatePrerequisiteReferences(body.prerequisites, context);

    await updateRevision(
      context,
      feature,
      revision,
      { prerequisites: body.prerequisites },
      {
        user: context.auditUser,
        action: "edit prerequisites",
        subject: "",
        value: JSON.stringify(body.prerequisites),
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

    await recordRevisionUpdate(
      context,
      feature,
      finalRevision,
      "prerequisites",
    );

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const putFeatureRevisionPrerequisites = createApiRequestHandler(
  putFeatureRevisionPrerequisitesValidator,
)(async (req) => {
  const { feature, revision } = await setRevisionPrerequisites(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
