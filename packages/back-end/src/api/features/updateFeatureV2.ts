import {
  validateFeatureValue,
  getConfigBackingPatch,
  getConfigBackingKey,
  normalizeTargetingInUpdates,
} from "shared/util";
import { isEqual } from "lodash";
import { updateFeatureV2Validator } from "shared/validators";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
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
  assertFeatureValuesValid,
  getApiFeatureObjV2,
  getNextScheduledUpdate,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { assertConfigBackedFeatureValuesValid } from "back-end/src/services/configValidation";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateEnvKeys } from "./postFeature";
import { validateCustomFields, validateRuleAttributes } from "./validations";
import { canBypassReviewChecks } from "./reviewBypass";
import {
  assertConfigSchemaCompat,
  assertValidHoldout,
  assertValidProjectId,
  assertValidProjectIds,
  assertValidRuleConfigKeys,
  assertValidBaseConfig,
  assertValidDefaultValueConfig,
  assertNoRawConfigExtends,
  composeConfigBacking,
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
    targetingAllProjects,
    targetingProjects,
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
    (effectiveProject ?? "") === ""
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
  await assertValidProjectIds(targetingProjects, req.context);

  if (
    !req.context.permissions.canPublishAddedTargetingProjects(
      feature,
      { targetingAllProjects, targetingProjects },
      Array.from(getEnabledEnvironments(feature, orgEnvs)),
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

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

  const jsonSchema =
    feature.valueType !== "boolean" && (req.body.jsonSchema ?? null) !== null
      ? parseApiJsonSchema(
          req.organization,
          req.body.jsonSchema,
          feature.valueType,
        )
      : null;

  // Validate values against the EFFECTIVE schema — the inbound `jsonSchema` when
  // one is sent, else the flag's current schema — so a request that relaxes or
  // tightens the schema is judged against the schema it's also setting.
  const effectiveFeature = {
    ...feature,
    ...(jsonSchema !== null ? { jsonSchema } : {}),
  };

  let defaultValue: string | undefined;
  if (req.body.defaultValue != null) {
    // Always normalize (parse / dirty-json fixup), but only enforce the schema
    // when not explicitly skipped.
    defaultValue = validateFeatureValue(
      req.context.skipSchemaValidation
        ? { ...effectiveFeature, jsonSchema: undefined }
        : effectiveFeature,
      req.body.defaultValue,
      "Default value",
    );
  }

  // The backing config is fixed at creation — reject any attempt to change it
  // (a no-op resend of the same value is allowed). Matches the UI, which only
  // sets baseConfig when the feature is created.
  if (
    req.body.baseConfig !== undefined &&
    (req.body.baseConfig ?? null) !== (feature.baseConfig ?? null)
  ) {
    throw new BadRequestError(
      `The backing config cannot be changed after creation (existing: ${
        feature.baseConfig ? `"${feature.baseConfig}"` : "none"
      }, provided: ${
        req.body.baseConfig ? `"${req.body.baseConfig}"` : "none"
      }).`,
    );
  }

  // Config backing via dedicated fields. `baseConfig` (Config mode) and
  // `defaultValueConfig` (the default's optional descendant extension) are set
  // through fields, never a raw `@config:` in the value.
  const effectiveBaseConfig =
    req.body.baseConfig !== undefined
      ? (req.body.baseConfig ?? null)
      : (feature.baseConfig ?? null);
  if (req.body.defaultValue != null) {
    assertNoRawConfigExtends(req.body.defaultValue, "defaultValue");
  }
  await assertValidBaseConfig(
    req.context,
    effectiveBaseConfig,
    feature.valueType,
    effectiveProject,
  );
  await assertValidDefaultValueConfig(
    req.context,
    effectiveBaseConfig,
    req.body.defaultValueConfig,
    effectiveProject,
  );

  // Recompose the stored default when its value or its extension changes: a
  // `defaultValueConfig` descendant becomes the value's own `$extends`; a bare
  // `baseConfig` leaves it a pure patch the compiler resolves. Editing only the
  // value keeps the existing extension; editing only the extension re-points the
  // existing patch.
  const dvcProvided = req.body.defaultValueConfig !== undefined;
  let storedDefault: string | undefined;
  if (defaultValue != null || dvcProvided) {
    const patch = getConfigBackingPatch(defaultValue ?? feature.defaultValue);
    const dvc = dvcProvided
      ? (req.body.defaultValueConfig ?? null)
      : getConfigBackingKey(feature.defaultValue);
    storedDefault =
      dvc !== null ? composeConfigBacking(dvc, patch, "Default value") : patch;
  }

  const prerequisites =
    req.body.prerequisites != null
      ? req.body.prerequisites?.map((p) => ({
          id: p,
          condition: `{"value": true}`,
        }))
      : null;

  await assertValidHoldout(req.body.holdout, req.context);

  // Block a config-backed default value coexisting with an enabled JSON schema
  // (either inbound or already on the flag), using the effective post-update
  // values.
  assertConfigSchemaCompat({
    jsonSchemaEnabled: (jsonSchema ?? feature.jsonSchema)?.enabled,
    baseConfig: effectiveBaseConfig,
  });

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
    // Request-supplied config keys must exist, be live, and belong to the
    // default config's family — same gate as the revision rule endpoints.
    await assertValidRuleConfigKeys(
      req.context,
      req.body.rules.flatMap((rule) => [
        "config" in rule ? (rule as { config?: string | null }).config : null,
        ...(rule.type === "experiment-ref"
          ? rule.variations.map((v) => v.config)
          : []),
      ]),
      defaultValue ?? feature.defaultValue,
      effectiveBaseConfig,
      effectiveProject,
    );
    addIdsToFlatRules(inboundFlatRules, feature.id);
    // `mapV2ApiRuleToFeatureRule` doesn't validate values; enforce the schema
    // here (against the effective schema, opt-out via ?skipSchemaValidation).
    assertFeatureValuesValid(req.context, effectiveFeature, {
      rules: inboundFlatRules,
    });
  }

  // Config-backed values (default + rules) validate against the backing config's
  // schema + invariants, using the effective post-update baseConfig.
  await assertConfigBackedFeatureValuesValid(
    req.context,
    { valueType: feature.valueType, baseConfig: effectiveBaseConfig },
    {
      defaultValue: storedDefault ?? feature.defaultValue,
      rules: inboundFlatRules ?? feature.rules,
    },
  );

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

  let updates: Partial<FeatureInterface> = {
    ...(ownerInput !== undefined ? { owner: owner ?? "" } : {}),
    ...(archived != null ? { archived } : {}),
    ...(description != null ? { description } : {}),
    ...(project != null ? { project } : {}),
    ...(targetingAllProjects != null ? { targetingAllProjects } : {}),
    ...(targetingProjects != null ? { targetingProjects } : {}),
    ...(tags != null ? { tags } : {}),
    ...(storedDefault !== undefined ? { defaultValue: storedDefault } : {}),
    ...(req.body.baseConfig !== undefined
      ? { baseConfig: req.body.baseConfig ?? null }
      : {}),
    ...(prerequisites != null ? { prerequisites } : {}),
    ...(jsonSchema != null ? { jsonSchema } : {}),
    ...(customFields != null ? { customFields } : {}),
  };
  normalizeTargetingInUpdates(updates, feature);

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
