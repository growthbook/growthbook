import cloneDeep from "lodash/cloneDeep";
import { deleteFeatureRevisionRuleValidator } from "shared/validators";
import { resetReviewOnChange, ruleAppliesToEnv, stemRuleId } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { toApiRevision } from "back-end/src/services/features";
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

    // v2: revision.rules is a flat FeatureRule[]. Scope deletion to rules
    // that (a) match the ruleId (with support for the id__env disambiguation
    // suffix via stemRuleId) and (b) apply to the target environment. If a
    // shared rule lives across multiple envs, narrow its scope to drop just
    // this env.
    const flat = cloneDeep(revision.rules ?? []);
    const matchesRule = (r: { id?: string }) =>
      r.id === req.params.ruleId ||
      stemRuleId(r.id ?? "") === req.params.ruleId;
    const deletedRule = flat.find(
      (r) => matchesRule(r) && ruleAppliesToEnv(r, environment),
    );
    if (!deletedRule) {
      throw new NotFoundError(
        `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
      );
    }

    const newFlat: typeof flat = [];
    for (const r of flat) {
      if (r !== deletedRule) {
        newFlat.push(r);
        continue;
      }
      // Multi-env scope: narrow rather than remove globally.
      if (
        !r.allEnvironments &&
        Array.isArray(r.environments) &&
        r.environments.length > 1
      ) {
        newFlat.push({
          ...r,
          environments: r.environments.filter((e) => e !== environment),
        });
      }
      // Otherwise drop the rule.
    }

    const changes: RevisionChanges = { rules: newFlat };

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
      // v2: feature.rules is the authoritative flat rule array.
      const liveRules = (feature.rules ?? []).filter(
        (r) => r.type === "safe-rollout",
      );
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

    return { revision: toApiRevision(finalRevision, req.context, feature) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
