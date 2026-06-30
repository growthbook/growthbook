import cloneDeep from "lodash/cloneDeep";
import { deleteFeatureRevisionRuleValidator } from "shared/validators";
import { resetReviewOnChange, ruleAppliesToEnv } from "shared/util";
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
  getApplicableEnvIds,
  narrowRuleForEnvRemoval,
} from "back-end/src/util/flattenRules";
import { getEnvironments } from "back-end/src/util/organization.util";
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

  // Reject envs scoped out of the feature's project. Without this, a delete
  // request for a non-applicable env produces a phantom narrow (e.g.
  // `allEnvironments: true` → explicit list of applicable envs with the
  // same effective coverage) — looks like success but doesn't change
  // anything the user can observe.
  const orgEnvs = getEnvironments(req.organization);
  const applicableEnvs = getApplicableEnvIds(orgEnvs, feature.project);
  if (!applicableEnvs.includes(environment)) {
    throw new BadRequestError(
      `Environment "${environment}" is not applicable to this feature's project`,
    );
  }

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

    // v2: revision.rules is a flat FeatureRule[]. The v1-shaped DELETE route
    // is per-env — it narrows the matched rule's footprint to "all envs
    // except this one." When the narrowed footprint collapses to zero envs
    // (i.e. the target env was the last one this rule applied to) the rule
    // is dropped entirely; v1 callers expect DELETE from the final env to
    // remove the rule, not leave a zero-footprint orphan.
    //
    // Rule identity is exact: v2 callers MUST supply the full qualified
    // `rule.id` as emitted by getter endpoints (including any `__<env>`
    // migration suffix). No stem reconstruction.
    const flat = cloneDeep(revision.rules ?? []);
    const deletedRule = flat.find(
      (r) => r.id === req.params.ruleId && ruleAppliesToEnv(r, environment),
    );
    if (!deletedRule) {
      throw new NotFoundError(
        `Rule "${req.params.ruleId}" not found in environment "${environment}"`,
      );
    }

    // `narrowRuleForEnvRemoval` encapsulates the narrow-vs-delete decision:
    //   - `allEnvironments: true` expands to the full applicable set before
    //     narrowing, so we emit an explicit list of every other env.
    //   - If the target env is the last one the rule applied to, the rule is
    //     fully removed (v1 DELETE-from-last-env = delete the rule).
    //   - An explicit `environments: []` rule is applies-nowhere and would
    //     already have 404'd via `ruleAppliesToEnv` above.
    const decision = narrowRuleForEnvRemoval(
      deletedRule,
      environment,
      applicableEnvs,
    );
    const fullyDeleted = decision.action === "delete";

    const newFlat: typeof flat = [];
    for (const r of flat) {
      if (r !== deletedRule) {
        newFlat.push(r);
        continue;
      }
      if (fullyDeleted) continue;
      newFlat.push(decision.rule);
    }

    const changes: RevisionChanges = { rules: newFlat };

    // Ramp actions belong to a specific rule; only strip them if the rule
    // itself is being fully removed. A narrowed rule still exists and its
    // pending ramp schedule should survive the env-scoped delete.
    if (fullyDeleted) {
      const existingActions = revision.rampActions ?? [];
      const filteredActions = existingActions.filter(
        (a) => !("ruleId" in a) || a.ruleId !== req.params.ruleId,
      );
      if (filteredActions.length !== existingActions.length) {
        changes.rampActions = filteredActions;
      }
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

    // Clean up the SafeRollout only when the rule was removed entirely and
    // the live feature no longer references it. A narrowed rule still exists
    // in the draft and continues to own its SafeRollout.
    if (
      fullyDeleted &&
      deletedRule?.type === "safe-rollout" &&
      deletedRule.safeRolloutId
    ) {
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
      feature,
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
