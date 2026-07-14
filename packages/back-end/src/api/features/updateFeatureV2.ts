import { validateFeatureValue } from "shared/util";
import { isEqual } from "lodash";
import { updateFeatureV2Validator } from "shared/validators";
import {
  FeatureInterface,
  FeatureRule,
  FeatureDefaultValueOverride,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerEmail,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
  createAndPublishRevision,
} from "back-end/src/models/FeatureModel";
import {
  getExperimentMapForFeature,
  addLinkedFeatureToExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  addIdsToFlatRules,
  getApiFeatureObjV2,
  getNextScheduledUpdate,
  getSavedGroupMap,
} from "back-end/src/services/features";
import {
  getEnabledEnvironments,
  validateEnvKeys,
  validateAndNormalizeDefaultValueOverrides,
} from "back-end/src/util/features";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateCustomFields, validateRuleAttributes } from "./validations";
import { canBypassReviewChecks } from "./reviewBypass";
import {
  assertValidHoldout,
  assertValidProjectId,
  extractRevisionMetadata,
  mapV2ApiRuleToFeatureRule,
} from "./v2Shared";

export const updateFeatureV2 = createApiRequestHandler(
  updateFeatureV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new Error(`Feature id '${req.params.id}' not found.`);
  }

  const {
    owner: ownerInput,
    archived,
    description,
    project,
    tags,
    customFields,
  } = req.body;
  const owner = await resolveOwnerToUserId(ownerInput, req.context);

  const effectiveProject =
    typeof project === "undefined" ? feature.project : project;

  const orgEnvs = getEnvironmentIdsFromOrg(req.context.org);

  if (!req.context.permissions.canUpdateFeature(feature, req.body)) {
    req.context.permissions.throwPermissionError();
  }
  if (
    req.context.org.settings?.requireProjectForFeatures &&
    feature.project &&
    (effectiveProject == null || effectiveProject === "")
  ) {
    throw new Error("Must specify a project");
  }

  if (project != null) {
    if (
      !req.context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, orgEnvs)),
      ) ||
      !req.context.permissions.canPublishFeature(
        { project },
        Array.from(getEnabledEnvironments(feature, orgEnvs)),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  await assertValidProjectId(project, req.context);

  const projectChanged = project !== undefined && project !== feature.project;
  const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
    existingCustomFieldValues: feature.customFields,
    updatedCustomFieldValues: customFields,
  });

  if (projectChanged || customFieldsChanged) {
    await validateCustomFields(
      customFields ?? feature.customFields,
      req.context,
      effectiveProject,
    );
  }

  if (req.body.environments != null) {
    validateEnvKeys(orgEnvs, Object.keys(req.body.environments ?? {}));
  }

  let defaultValue: string | undefined;
  if (req.body.defaultValue != null) {
    defaultValue = validateFeatureValue(feature, req.body.defaultValue);
  }

  const prerequisites =
    req.body.prerequisites != null
      ? req.body.prerequisites?.map((p) => ({
          id: p,
          condition: `{"value": true}`,
        }))
      : null;

  await assertValidHoldout(req.body.holdout, req.context);

  const jsonSchema =
    feature.valueType !== "boolean" && req.body.jsonSchema != null
      ? parseApiJsonSchema(
          req.organization,
          req.body.jsonSchema,
          feature.valueType,
        )
      : null;

  let inboundFlatRules: FeatureRule[] | null = null;
  if (req.body.rules != null) {
    // Opt-in registered-attribute check on each replacement rule before any
    // DB writes. `mapV2ApiRuleToFeatureRule` doesn't validate, so we cover
    // flat v2 rules explicitly here (env-rules go through `fromApiEnvSettings…`).
    for (const rule of req.body.rules) {
      validateRuleAttributes(
        rule as Parameters<typeof validateRuleAttributes>[0],
        req.context,
        feature.project,
      );
    }
    inboundFlatRules = req.body.rules.map((rule) =>
      mapV2ApiRuleToFeatureRule(rule, feature),
    );
    addIdsToFlatRules(inboundFlatRules, feature.id);
  }

  const changedEnvEnabled: Record<string, boolean> = {};
  if (req.body.environments) {
    for (const [env, s] of Object.entries(req.body.environments)) {
      if (
        typeof s.enabled === "boolean" &&
        s.enabled !== feature.environmentSettings?.[env]?.enabled
      ) {
        changedEnvEnabled[env] = s.enabled;
      }
    }
  }

  // Default value overrides: a COMPLETE list (full-replace) when present.
  let nextDefaultValueOverrides: FeatureDefaultValueOverride[] | undefined;
  if (req.body.defaultValueOverrides !== undefined) {
    nextDefaultValueOverrides = validateAndNormalizeDefaultValueOverrides(
      feature,
      req.body.defaultValueOverrides,
      orgEnvs,
    );
  }
  const hasEnvDefaultChanges =
    nextDefaultValueOverrides !== undefined &&
    !isEqual(nextDefaultValueOverrides, feature.defaultValueOverrides ?? []);

  let updates: Partial<FeatureInterface> = {
    ...(ownerInput !== undefined ? { owner: owner ?? "" } : {}),
    ...(archived != null ? { archived } : {}),
    ...(description != null ? { description } : {}),
    ...(project != null ? { project } : {}),
    ...(tags != null ? { tags } : {}),
    ...(defaultValue != null ? { defaultValue } : {}),
    ...(prerequisites != null ? { prerequisites } : {}),
    ...(jsonSchema != null ? { jsonSchema } : {}),
    ...(customFields != null ? { customFields } : {}),
  };

  if (
    updates.defaultValue != null ||
    updates.project != null ||
    updates.archived != null ||
    inboundFlatRules != null
  ) {
    if (
      !req.context.permissions.canPublishFeature(
        { project: effectiveProject },
        Array.from(getEnabledEnvironments({ ...feature, ...updates }, orgEnvs)),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  if (inboundFlatRules != null || updates.defaultValue !== undefined) {
    updates.nextScheduledUpdate = getNextScheduledUpdate(
      inboundFlatRules ?? feature.rules,
    );
  }

  // JWT-backed REST calls should behave like dashboard actions: the org-level
  // REST bypass setting only applies to API keys/PATs.
  const canBypass = canBypassReviewChecks(req, feature);

  const newTagsForDiff = updates.tags;

  const { metadata: metadataChanges, remaining: updatesAfterMetadata } =
    extractRevisionMetadata(updates);
  updates = updatesAfterMetadata;

  const newPrerequisites = updates.prerequisites ?? null;
  if (newPrerequisites !== null) {
    delete updates.prerequisites;
  }

  const newArchived =
    updates.archived !== undefined && updates.archived !== feature.archived
      ? updates.archived
      : null;
  if (newArchived !== null) {
    delete updates.archived;
  }

  const holdoutFieldProvided = "holdout" in req.body;
  const newHoldout = holdoutFieldProvided
    ? (req.body.holdout ?? null)
    : undefined;
  const hasHoldoutChange =
    holdoutFieldProvided &&
    !isEqual(newHoldout ?? null, feature.holdout ?? null);

  const defaultValueChanged =
    updates.defaultValue !== undefined &&
    updates.defaultValue !== feature.defaultValue;
  const hasRuleChanges =
    defaultValueChanged ||
    (inboundFlatRules != null &&
      !isEqual(inboundFlatRules, feature.rules ?? []));
  const hasEnvEnabledChanges = Object.keys(changedEnvEnabled).length > 0;
  const hasMetadataChanges = Object.keys(metadataChanges).length > 0;
  const hasPrereqChanges = newPrerequisites !== null;
  const hasArchivedChange = newArchived !== null;

  const hasRevisionChanges =
    hasEnvEnabledChanges ||
    hasEnvDefaultChanges ||
    hasRuleChanges ||
    hasMetadataChanges ||
    hasPrereqChanges ||
    hasArchivedChange ||
    hasHoldoutChange;

  if (hasRevisionChanges) {
    const revisionChanges: Partial<FeatureRevisionInterface> = {
      ...(hasEnvEnabledChanges
        ? { environmentsEnabled: changedEnvEnabled }
        : {}),
      ...(hasEnvDefaultChanges
        ? { defaultValueOverrides: nextDefaultValueOverrides }
        : {}),
      ...(hasRuleChanges || hasEnvEnabledChanges
        ? {
            rules: inboundFlatRules ?? feature.rules ?? [],
            ...(updates.defaultValue !== undefined
              ? { defaultValue: updates.defaultValue }
              : {}),
          }
        : {}),
      ...(hasMetadataChanges ? { metadata: metadataChanges } : {}),
      ...(hasPrereqChanges ? { prerequisites: newPrerequisites } : {}),
      ...(hasArchivedChange ? { archived: newArchived } : {}),
      ...(hasHoldoutChange ? { holdout: newHoldout ?? null } : {}),
    };

    const { revision, updatedFeature: updatedFeatureFromRevision } =
      await createAndPublishRevision({
        context: req.context,
        feature,
        user: req.eventAudit,
        org: req.organization,
        changes: revisionChanges,
        comment: "Created via REST API",
        canBypassApprovalChecks: canBypass,
      });

    Object.assign(feature, updatedFeatureFromRevision);
    updates.version = revision.version;

    // Ensure linkedFeatures is set on any experiments referenced by the
    // newly-live rules. Fire-and-forget; clearPendingFeatureDraftsForRevision
    // (inside publishRevision) already handles pendingFeatureDrafts cleanup.
    if (inboundFlatRules) {
      for (const rule of inboundFlatRules) {
        if (rule.type === "experiment-ref" || rule.type === "experiment") {
          addLinkedFeatureToExperiment(
            req.context,
            (rule as { experimentId: string }).experimentId,
            feature.id,
          ).catch(() => {
            // best-effort
          });
        }
      }
    }
  }

  const updatedFeature = await updateFeatureToDb(req.context, feature, updates);

  await addTagsDiff(
    req.context.org.id,
    feature.tags || [],
    newTagsForDiff || [],
  );

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature),
  });

  const groupMap = await getSavedGroupMap(req.context);
  const experimentMap = await getExperimentMapForFeature(
    req.context,
    feature.id,
  );
  const revision = await getRevision({
    context: req.context,
    organization: updatedFeature.organization,
    featureId: updatedFeature.id,
    feature: updatedFeature,
    version: updatedFeature.version,
  });
  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();
  return {
    feature: await resolveOwnerEmail(
      getApiFeatureObjV2({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
        safeRolloutMap,
      }),
      req.context,
    ),
  };
});
