import type { OrganizationInterface } from "shared/types/organization";
import { postFeatureRevisionToggleValidator } from "shared/validators";
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
  assertValidEnvironment,
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export async function toggleRevisionEnvironment(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new" },
  body: {
    environment: string;
    enabled: boolean;
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

  const { environment, enabled } = body;
  assertValidEnvironment(context, environment);

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

    const currentEnabled =
      revision.environmentsEnabled?.[environment] ??
      feature.environmentSettings?.[environment]?.enabled ??
      false;
    if (currentEnabled === enabled) {
      await discardIfJustCreated(context, revision, created);
      return { feature, revision };
    }

    const newEnabled = {
      ...(revision.environmentsEnabled ?? {}),
      [environment]: enabled,
    };

    await updateRevision(
      context,
      feature,
      revision,
      { environmentsEnabled: newEnabled },
      {
        user: context.auditUser,
        action: enabled ? "enable environment" : "disable environment",
        subject: environment,
        value: JSON.stringify({ enabled }),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: [environment],
        defaultValueChanged: false,
        settings: organization.settings,
      }),
    );

    const updated = await getRevision({
      context: context,
      organization: organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(context, feature, finalRevision, "toggle", {
      environments: [environment],
      auditDetails: { enabled },
    });

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const postFeatureRevisionToggle = createApiRequestHandler(
  postFeatureRevisionToggleValidator,
)(async (req) => {
  const { feature, revision } = await toggleRevisionEnvironment(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
