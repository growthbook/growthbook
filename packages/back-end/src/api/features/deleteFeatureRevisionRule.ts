import cloneDeep from "lodash/cloneDeep";
import { deleteFeatureRevisionRuleValidator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { revisionToApiInterface } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
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

  const { environment } = req.body;
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

    const newRules = cloneDeep(revision.rules ?? {});
    const before = newRules[environment]?.length ?? 0;
    const deletedRule = (newRules[environment] ?? []).find(
      (r) => r.id === req.params.ruleId,
    );
    newRules[environment] = (newRules[environment] ?? []).filter(
      (r) => r.id !== req.params.ruleId,
    );
    if (newRules[environment].length === before) {
      throw new NotFoundError(
        `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
      );
    }

    const changes: RevisionChanges = { rules: newRules };

    // Strip pending ramp actions for this rule so they don't fail at publish.
    const existingActions = revision.rampActions ?? [];
    const filteredActions = existingActions.filter(
      (a) => a.ruleId !== req.params.ruleId,
    );
    if (filteredActions.length !== existingActions.length) {
      changes.rampActions = filteredActions;
    }

    await updateRevision(
      req.context,
      feature,
      revision,
      changes,
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

    // Clean up the SafeRollout only if it's draft-only and hasn't started.
    // If it's still referenced by the live feature, publish handles lifecycle.
    if (deletedRule?.type === "safe-rollout" && deletedRule.safeRolloutId) {
      const liveRules = Object.values(feature.environmentSettings ?? {})
        .flatMap((env) => env.rules ?? [])
        .filter((r) => r.type === "safe-rollout");
      const stillLive = liveRules.some(
        (r) =>
          "safeRolloutId" in r && r.safeRolloutId === deletedRule.safeRolloutId,
      );
      if (!stillLive) {
        try {
          const sr = await req.context.models.safeRollout.getById(
            deletedRule.safeRolloutId,
          );
          if (sr && !sr.startedAt) {
            await req.context.models.safeRollout.deleteById(
              deletedRule.safeRolloutId,
            );
          }
        } catch (err) {
          logger.warn(
            { err, safeRolloutId: deletedRule.safeRolloutId },
            "Failed to clean up draft-only SafeRollout",
          );
        }
      }
    }

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
      "rule.delete",
      {
        environments: [environment],
        auditDetails: { ruleId: req.params.ruleId },
      },
    );

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
