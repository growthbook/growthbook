import type { OrganizationInterface } from "shared/types/organization";
import { putFeatureRevisionHoldoutValidator } from "shared/validators";
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

export async function setRevisionHoldout(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new" },
  body: {
    holdout: { id: string; value: string } | null;
    revisionTitle?: string;
    revisionComment?: string;
  },
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  if (body.holdout) {
    const holdout = await context.models.holdout.getById(body.holdout.id);
    if (!holdout) {
      throw new NotFoundError(`Could not find holdout "${body.holdout.id}"`);
    }
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

    // Side effects (linking the feature/experiments to the holdout) run at
    // publish time via applyHoldoutSideEffects, not here.
    await updateRevision(
      context,
      feature,
      revision,
      { holdout: body.holdout },
      {
        user: context.auditUser,
        action: body.holdout ? "set holdout" : "clear holdout",
        subject: body.holdout?.id ?? "",
        value: JSON.stringify(body.holdout),
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

    await recordRevisionUpdate(context, feature, finalRevision, "holdout", {
      auditDetails: { holdoutId: body.holdout?.id ?? null },
    });

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const putFeatureRevisionHoldout = createApiRequestHandler(
  putFeatureRevisionHoldoutValidator,
)(async (req) => {
  const { feature, revision } = await setRevisionHoldout(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
