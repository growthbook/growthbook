import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";

const DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
];

export const postFeatureRevisionRulesReorder = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    environment: z.string(),
    ruleIds: z.array(z.string()),
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

  if (!DRAFT_STATUSES.includes(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { environment, ruleIds } = req.body;
  const envRules = revision.rules?.[environment] ?? [];

  const ruleMap = new Map(envRules.map((r) => [r.id, r]));

  const unknownIds = ruleIds.filter((id) => !ruleMap.has(id));
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown rule ID(s): ${unknownIds.join(", ")}. ruleIds must contain exactly the existing rule IDs for this environment.`,
    );
  }

  const seen = new Set<string>();
  const duplicateIds = ruleIds.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate rule ID(s): ${duplicateIds.join(", ")}.`);
  }

  const missingIds = envRules.map((r) => r.id).filter((id) => !seen.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Missing rule ID(s): ${missingIds.join(", ")}. ruleIds must contain exactly the existing rule IDs for this environment.`,
    );
  }

  const reordered = ruleIds.map((id) => ruleMap.get(id)!);

  const newRules = cloneDeep(revision.rules ?? {});
  newRules[environment] = reordered;

  await updateRevision(
    req.context,
    feature,
    revision,
    { rules: newRules },
    {
      user: req.context.auditUser,
      action: "reorder rules",
      subject: environment,
      value: JSON.stringify(ruleIds),
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
