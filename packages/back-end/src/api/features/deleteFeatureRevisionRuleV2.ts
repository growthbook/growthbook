import { deleteFeatureRevisionRuleV2Validator } from "shared/validators";
import { resetReviewOnChange } from "shared/util";
import { RevisionChanges } from "shared/types/feature-revision";
import { toApiRevisionV2 } from "back-end/src/services/features";
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
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";

export const deleteFeatureRevisionRuleV2 = createApiRequestHandler(
  deleteFeatureRevisionRuleV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canManageFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
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

    // V2: delete rule by ruleId entirely — no per-env narrowing.
    const flat = (revision.rules ?? []).slice();
    const ruleIdx = flat.findIndex((r) => r.id === req.params.ruleId);
    if (ruleIdx === -1) {
      throw new NotFoundError(`Rule "${req.params.ruleId}" not found`);
    }

    const deletedRule = flat[ruleIdx];
    const newFlat = flat.filter((_, i) => i !== ruleIdx);

    // Strip ramp actions for the deleted rule.
    const changes: RevisionChanges = { rules: newFlat };
    const existingActions = revision.rampActions ?? [];
    const filteredActions = existingActions.filter(
      (a) => !("ruleId" in a) || a.ruleId !== req.params.ruleId,
    );
    if (filteredActions.length !== existingActions.length) {
      changes.rampActions = filteredActions;
    }

    // Affected envs for review reset.
    const deletedRuleEnvs = deletedRule.allEnvironments
      ? Object.keys(feature.environmentSettings ?? {})
      : (deletedRule.environments ?? []);

    await updateRevision(
      req.context,
      feature,
      revision,
      changes,
      {
        user: req.context.auditUser,
        action: "delete rule",
        subject: req.params.ruleId,
        value: JSON.stringify({}),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: deletedRuleEnvs,
        defaultValueChanged: false,
        settings: req.organization.settings,
      }),
    );

    // Clean up SafeRollout if still only a draft rule.
    if (
      deletedRule?.type === "safe-rollout" &&
      (deletedRule as typeof deletedRule & { safeRolloutId: string })
        .safeRolloutId
    ) {
      const srId = (
        deletedRule as typeof deletedRule & { safeRolloutId: string }
      ).safeRolloutId;
      const liveRules = (feature.rules ?? []).filter(
        (r) => r.type === "safe-rollout",
      );
      const stillLive = liveRules.some(
        (r) =>
          "safeRolloutId" in r &&
          (r as typeof deletedRule & { safeRolloutId: string })
            .safeRolloutId === srId,
      );
      if (!stillLive) {
        try {
          const sr = await req.context.models.safeRollout.getById(srId);
          if (sr && !sr.startedAt)
            await req.context.models.safeRollout.deleteById(srId);
        } catch (err) {
          logger.warn(
            { err, safeRolloutId: srId },
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
        environments: deletedRuleEnvs,
        auditDetails: { ruleId: req.params.ruleId },
      },
    );

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
