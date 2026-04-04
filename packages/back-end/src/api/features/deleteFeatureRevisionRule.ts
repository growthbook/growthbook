import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import { resetReviewOnChange } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { isDraftStatus } from "./validations";

export const deleteFeatureRevisionRule = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.coerce.number().int(),
    ruleId: z.string(),
  }),
  bodySchema: z.object({
    environment: z.string(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new Error("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { environment } = req.body;
  const newRules = cloneDeep(revision.rules ?? {});
  const before = newRules[environment]?.length ?? 0;
  newRules[environment] = (newRules[environment] ?? []).filter(
    (r) => r.id !== req.params.ruleId,
  );
  if (newRules[environment].length === before) {
    throw new Error(
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
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
