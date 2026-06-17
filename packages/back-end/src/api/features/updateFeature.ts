import { validateFeatureValue, getRulesForEnvironment } from "shared/util";
import { isEqual } from "lodash";
import { updateFeatureValidator } from "shared/validators";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
  createAndPublishRevision,
} from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  addIdsToFlatRules,
  addIdsToRules,
  fromApiEnvSettingsRulesToFeatureEnvSettingsRules,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  updateInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getRevision,
  normalizeRulesInputToV2,
} from "back-end/src/models/FeatureRevisionModel";
import {
  getEnvironments,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validations";
import { canBypassReviewChecks } from "./reviewBypass";
import {
  assertValidHoldout,
  assertValidProjectId,
  extractRevisionMetadata,
  validateEnvRulesScheduleRules,
} from "./v2Shared";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req) => {
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

    // check if the custom fields are valid
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

    // ensure environment keys are valid
    if (req.body.environments != null) {
      validateEnvKeys(orgEnvs, Object.keys(req.body.environments ?? {}));
    }

    validateEnvRulesScheduleRules(req.body.environments, req.context);

    // ensure default value matches value type
    let defaultValue;
    if (req.body.defaultValue != null) {
      defaultValue = validateFeatureValue(feature, req.body.defaultValue);
    }

    const environmentSettings =
      req.body.environments != null
        ? updateInterfaceEnvSettingsFromApiEnvSettings(
            feature,
            req.body.environments,
          )
        : null;

    const prerequisites =
      req.body.prerequisites != null
        ? req.body.prerequisites?.map((p) => ({
            id: p,
            condition: `{"value": true}`,
          }))
        : null;

    await assertValidHoldout(req.body.holdout, req.context);

    const jsonSchema =
      feature.valueType === "json" && req.body.jsonSchema != null
        ? parseApiJsonSchema(req.organization, req.body.jsonSchema)
        : null;

    let updates: Partial<FeatureInterface> = {
      ...(ownerInput !== undefined ? { owner: owner ?? "" } : {}),
      ...(archived != null ? { archived } : {}),
      ...(description != null ? { description } : {}),
      ...(project != null ? { project } : {}),
      ...(tags != null ? { tags } : {}),
      ...(defaultValue != null ? { defaultValue } : {}),
      ...(environmentSettings != null ? { environmentSettings } : {}),
      ...(prerequisites != null ? { prerequisites } : {}),
      ...(jsonSchema != null ? { jsonSchema } : {}),
      ...(customFields != null ? { customFields } : {}),
    };

    if (
      updates.environmentSettings ||
      updates.defaultValue != null ||
      updates.project != null ||
      updates.archived != null
    ) {
      if (
        !req.context.permissions.canPublishFeature(
          { project: effectiveProject },
          Array.from(
            getEnabledEnvironments(
              {
                ...feature,
                ...updates,
              },
              orgEnvs,
            ),
          ),
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
      addIdsToRules(updates.environmentSettings, feature.id);
    }

    // Recompute next-scheduled-update whenever top-level `rules` OR
    // `environmentSettings` change (the latter for REST callers still posting
    // v1-shape env rules, which adapters normalize upstream).
    if (updates.rules !== undefined || updates.environmentSettings) {
      updates.nextScheduledUpdate = getNextScheduledUpdate(
        updates.rules ?? feature.rules,
      );
    }

    // JWT-backed REST calls should behave like dashboard actions: the org-level
    // REST bypass setting only applies to API keys/PATs.
    const canBypass = canBypassReviewChecks(req, feature);

    // Tags go into the revision metadata; capture them before stripping from updates.
    const newTagsForDiff = updates.tags;

    // Build a single combined revision for all change types.

    // 1. environmentsEnabled (kill switches)
    const changedEnvEnabled: Record<string, boolean> = {};
    if (updates.environmentSettings) {
      for (const [env, settings] of Object.entries(
        updates.environmentSettings,
      )) {
        if (
          typeof settings.enabled === "boolean" &&
          settings.enabled !== feature.environmentSettings?.[env]?.enabled
        ) {
          changedEnvEnabled[env] = settings.enabled;
          // Exclude enabled from the direct-write path to avoid applying it twice.
          updates.environmentSettings[env] = {
            ...updates.environmentSettings[env],
            enabled: feature.environmentSettings?.[env]?.enabled ?? false,
          };
        }
      }
    }

    // 2. rules / defaultValue
    // v2: rules live on feature.rules (flat). Normalize inbound per-env rules
    // through `normalizeRulesInputToV2` so content-identical rules across envs
    // collapse to a single v2 rule with `environments: [...envs]` (or
    // `allEnvironments: true` when applicable) — matches the read-path JIT
    // and preserves v1 round-trip semantics for clients that send the same
    // rule id across envs. Then union with existing rules for envs the caller
    // didn't touch so we don't lose them on partial updates.
    const incomingEnvs = req.body.environments ?? {};
    const touchedEnvs = new Set(Object.keys(incomingEnvs));
    const inboundRulesByEnv: Record<string, FeatureRule[]> = {};
    for (const [env, envSettings] of Object.entries(incomingEnvs)) {
      if (!envSettings.rules) continue;
      const converted = fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
        req.context,
        feature,
        envSettings.rules,
        feature.rules ?? [],
      );
      // Stamp ids before flattening — `flattenV1ToV2Rules` groups by id and
      // drops id-less rules. Without this, v1 clients that omit ids would
      // lose those rules on PUT.
      addIdsToFlatRules(converted, feature.id);
      inboundRulesByEnv[env] = converted;
    }
    const inboundFlatRules: FeatureRule[] =
      Object.keys(inboundRulesByEnv).length > 0
        ? normalizeRulesInputToV2(inboundRulesByEnv, {
            orgEnvs: getEnvironments(req.context.org),
            featureProject: effectiveProject,
          })
        : [];
    // Carry through untouched-env rules from the existing feature.
    const preservedRules: FeatureRule[] = (feature.rules ?? []).filter((r) => {
      if (r.allEnvironments) {
        // An all-env rule can only be left alone if the caller didn't touch
        // any env — otherwise it would be ambiguous which envs they meant to
        // affect. This matches legacy v1 semantics (untouched envs preserved).
        return true;
      }
      const envs = r.environments ?? [];
      // Keep if none of the rule's envs were touched.
      return envs.every((e) => !touchedEnvs.has(e));
    });
    const revisedRulesFlat: FeatureRule[] = [
      ...preservedRules,
      ...inboundFlatRules,
    ];

    const changedRuleEnvironments: string[] = [];
    let defaultValueChanged = false;

    if (
      updates.defaultValue !== undefined &&
      updates.defaultValue !== feature.defaultValue
    ) {
      defaultValueChanged = true;
    }
    if (updates.environmentSettings) {
      Object.keys(updates.environmentSettings).forEach((env) => {
        const inboundEnv = getRulesForEnvironment(inboundFlatRules, env);
        const currentEnv = getRulesForEnvironment(feature.rules ?? [], env);
        if (!isEqual(inboundEnv, currentEnv)) {
          changedRuleEnvironments.push(env);
        }
      });
    }

    // 3. metadata
    const { metadata: metadataChanges, remaining: updatesAfterMetadata } =
      extractRevisionMetadata(updates);
    updates = updatesAfterMetadata;

    // 4. prerequisites
    const newPrerequisites = updates.prerequisites ?? null;
    if (newPrerequisites !== null) {
      delete updates.prerequisites;
    }

    // 5. archived
    const newArchived =
      updates.archived !== undefined && updates.archived !== feature.archived
        ? updates.archived
        : null;
    if (newArchived !== null) {
      delete updates.archived;
    }

    // 6. holdout — absent: no change; null: remove; { id, value }: add/change
    const holdoutFieldProvided = "holdout" in req.body;
    const newHoldout = holdoutFieldProvided
      ? (req.body.holdout ?? null)
      : undefined;
    const hasHoldoutChange =
      holdoutFieldProvided &&
      !isEqual(newHoldout ?? null, feature.holdout ?? null);

    // Determine whether any revision-tracked change exists
    const hasEnvEnabledChanges = Object.keys(changedEnvEnabled).length > 0;
    const hasRuleChanges =
      defaultValueChanged || changedRuleEnvironments.length > 0;
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
              rules: revisedRulesFlat,
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

      // Throws if the revision requires approval and the caller cannot bypass.
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
    }

    const updatedFeature = await updateFeatureToDb(
      req.context,
      feature,
      updates,
    );

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
        getApiFeatureObj({
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
  },
);
