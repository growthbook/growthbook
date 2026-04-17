import cloneDeep from "lodash/cloneDeep";
import { postFeatureRevisionRulesReorderValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
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

export const postFeatureRevisionRulesReorder = createApiRequestHandler(
  postFeatureRevisionRulesReorderValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { environment, ruleIds } = req.body;
  assertValidEnvironment(req.context, environment);

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title: req.body.revisionTitle, comment: req.body.revisionComment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const envRules = revision.rules?.[environment] ?? [];

    const ruleMap = new Map(envRules.map((r) => [r.id, r]));

    const unknownIds = ruleIds.filter((id) => !ruleMap.has(id));
    if (unknownIds.length > 0) {
      throw new BadRequestError(
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
      throw new BadRequestError(
        `Duplicate rule ID(s): ${duplicateIds.join(", ")}.`,
      );
    }

    const missingIds = envRules.map((r) => r.id).filter((id) => !seen.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestError(
        `Missing rule ID(s): ${missingIds.join(", ")}. ruleIds must contain exactly the existing rule IDs for this environment.`,
      );
    }

    const reordered = ruleIds.map((id) => ruleMap.get(id)!);

    // Short-circuit no-op reorders — drops any auto-created draft too.
    const isNoop = envRules.every((r, i) => r.id === reordered[i].id);
    if (isNoop) {
      await discardIfJustCreated(req.context, revision, created);
      return { revision: revisionToApiInterface(revision) };
    }

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
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "rule.reorder",
      {
        environments: [environment],
        auditDetails: { ruleIds },
      },
    );

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
