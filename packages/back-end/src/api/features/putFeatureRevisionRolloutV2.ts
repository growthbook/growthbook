import {
  putFeatureRevisionRolloutV2Validator,
  RevisionRampCreateFeatureRolloutAction,
} from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const putFeatureRevisionRolloutV2 = createApiRequestHandler(
  putFeatureRevisionRolloutV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { revisionTitle, revisionComment, ...rolloutInput } = req.body;

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: revisionTitle, comment: revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    // Block if the feature already has an active rollout
    if (feature.activeRampScheduleId) {
      throw new BadRequestError(
        "This feature already has an active rollout. Complete or roll back the existing one first.",
      );
    }

    const action: RevisionRampCreateFeatureRolloutAction = {
      mode: "create-feature-rollout",
      name: rolloutInput.name,
      templateId: rolloutInput.templateId,
      steps: (rolloutInput.steps ?? []).map((s) => ({
        trigger: s.trigger,
        actions: s.actions ?? [],
        approvalNotes: s.approvalNotes ?? undefined,
        monitored: s.monitored,
        holdConditions: s.holdConditions,
        apiAdvance: s.apiAdvance,
      })),
      endActions: rolloutInput.endActions,
      startDate: rolloutInput.startDate ?? undefined,
      endCondition: rolloutInput.endCondition,
      gateConfig: rolloutInput.gateConfig,
      monitoringConfig: rolloutInput.monitoringConfig,
      lockdownConfig: rolloutInput.lockdownConfig,
    };

    // Upsert: replace any existing feature-level rollout action on this draft
    const otherActions = (revision.rampActions ?? []).filter(
      (a) => a.mode !== "create-feature-rollout",
    );
    const newRampActions = [...otherActions, action];

    const orgEnvs = getEnvironments(req.organization);
    const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);

    await updateRevision(
      req.context,
      feature,
      revision,
      { rampActions: newRampActions },
      {
        user: req.context.auditUser,
        action: "set feature rollout",
        subject: feature.id,
        value: JSON.stringify(action),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: applicableEnvs,
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
