import cloneDeep from "lodash/cloneDeep";
import { deleteFeatureRevisionRuleValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  assertValidEnvironment,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const deleteFeatureRevisionRule = createApiRequestHandler(
  deleteFeatureRevisionRuleValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${revision.status}"`,
    );
  }

  const { environment } = req.body;
  assertValidEnvironment(req.context, environment);
  const newRules = cloneDeep(revision.rules ?? {});
  const before = newRules[environment]?.length ?? 0;
  newRules[environment] = (newRules[environment] ?? []).filter(
    (r) => r.id !== req.params.ruleId,
  );
  if (newRules[environment].length === before) {
    throw new NotFoundError(
      `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
    );
  }

  await updateRevision(
    req.context,
    feature,
    revision,
    { rules: newRules },
    {
      user: req.context.auditUser,
      action: "delete rule",
      subject: req.params.ruleId,
      value: JSON.stringify({ environment }),
    },
    resetReviewOnChange({
      feature,
      changedEnvironments: [environment],
      defaultValueChanged: false,
      settings: req.organization.settings,
    }),
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: revision.version,
  });

  return { revision: revisionToApiInterface(updated ?? revision) };
});
