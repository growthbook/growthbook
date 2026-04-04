import omit from "lodash/omit";
import { z } from "zod";
import {
  revisionRampCreateAction,
  revisionRampDetachAction,
  RevisionRampCreateAction,
  RevisionRampDetachAction,
} from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { isDraftStatus } from "./validations";

const rampActionSchema = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampDetachAction,
]);

export const putFeatureRevisionRampActions = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    ruleId: z.string(),
    action: rampActionSchema.nullable(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

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
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { ruleId, action } = req.body;

  // Filter out any existing action for this ruleId, then optionally append the new one
  const existing = revision.rampActions ?? [];
  const filtered = existing.filter(
    (a) =>
      !(
        (a.mode === "create" &&
          (a as RevisionRampCreateAction).ruleId === ruleId) ||
        (a.mode === "detach" &&
          (a as RevisionRampDetachAction).ruleId === ruleId)
      ),
  );
  const newRampActions = action ? [...filtered, action] : filtered;

  await updateRevision(
    req.context,
    feature,
    revision,
    { rampActions: newRampActions },
    {
      user: req.context.auditUser,
      action: action ? "set ramp action" : "clear ramp action",
      subject: ruleId,
      value: JSON.stringify(action),
    },
    true,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
