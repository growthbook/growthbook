import { postFeatureRevisionRulesReorderV2Validator } from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import { resetReviewOnChange } from "shared/util";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
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

export const postFeatureRevisionRulesReorderV2 = createApiRequestHandler(
  postFeatureRevisionRulesReorderV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { ruleIds } = req.body;

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

    // V2: reorder the global flat rule array. `ruleIds` must exactly cover all rules.
    const flatRules: FeatureRule[] = revision.rules ?? [];
    const ruleMap = new Map(flatRules.map((r) => [r.id, r]));

    const unknownIds = ruleIds.filter((id) => !ruleMap.has(id));
    if (unknownIds.length > 0) {
      throw new NotFoundError(
        `Unknown rule ID(s): ${unknownIds.join(", ")}. ruleIds must contain exactly the existing rule IDs.`,
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

    const missingIds = flatRules.map((r) => r.id).filter((id) => !seen.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestError(
        `Missing rule ID(s): ${missingIds.join(", ")}. ruleIds must contain exactly the existing rule IDs.`,
      );
    }

    const reordered = ruleIds.map((id) => ruleMap.get(id)!);

    const isNoop = flatRules.every((r, i) => r.id === reordered[i].id);
    if (isNoop) {
      await discardIfJustCreated(req.context, revision, created);
      return { revision: toApiRevisionV2(revision) };
    }

    // Collect affected envs for review reset.
    const allEnvs = Object.keys(feature.environmentSettings ?? {});

    await updateRevision(
      req.context,
      feature,
      revision,
      { rules: reordered },
      {
        user: req.context.auditUser,
        action: "reorder rules",
        subject: "all environments",
        value: JSON.stringify(ruleIds),
      },
      resetReviewOnChange({
        feature,
        changedEnvironments: allEnvs,
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

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "rule.reorder",
      {
        environments: allEnvs,
        auditDetails: { ruleIds },
      },
    );

    return { revision: toApiRevisionV2(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
