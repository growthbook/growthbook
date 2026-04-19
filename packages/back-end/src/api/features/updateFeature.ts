import { validateFeatureValue, validateScheduleRules } from "shared/util";
import { isEqual } from "lodash";
import { updateFeatureValidator, RevisionRules } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerToUserId } from "back-end/src/services/owner";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
  createAndPublishRevision,
} from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  addIdsToRules,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  updateInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validations";

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

    // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
    if (project) {
      const projects = await req.context.getProjects();
      if (!projects.some((p) => p.id === req.body.project)) {
        throw new Error(
          `Project id ${req.body.project} is not a valid project.`,
        );
      }
    }

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

    // Validate scheduleRules before processing environment settings
    if (req.body.environments) {
      Object.entries(req.body.environments).forEach(
        ([envName, envSettings]) => {
          if (envSettings.rules) {
            envSettings.rules.forEach((rule, ruleIndex) => {
              if (rule.scheduleRules) {
                // Validate that the org has access to schedule rules
                if (!req.context.hasPremiumFeature("schedule-feature-flag")) {
                  throw new Error(
                    "This organization does not have access to schedule rules. Upgrade to Pro or Enterprise.",
                  );
                }
                try {
                  validateScheduleRules(rule.scheduleRules);
                } catch (error) {
                  throw new Error(
                    `Invalid scheduleRules in environment "${envName}", rule ${
                      ruleIndex + 1
                    }: ${error.message}`,
                  );
                }
              }
            });
          }
        },
      );
    }

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

    // Validate holdout ID if provided
    if (req.body.holdout !== undefined && req.body.holdout !== null) {
      const holdoutObj = await req.context.models.holdout.getById(
        req.body.holdout.id,
      );
      if (!holdoutObj) {
        throw new Error(`Holdout id '${req.body.holdout.id}' not found.`);
      }
    }

    const jsonSchema =
      feature.valueType === "json" && req.body.jsonSchema != null
        ? parseApiJsonSchema(req.organization, req.body.jsonSchema)
        : null;

    const updates: Partial<FeatureInterface> = {
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

    if (updates.environmentSettings) {
      updates.nextScheduledUpdate = getNextScheduledUpdate(
        updates.environmentSettings,
        orgEnvs,
      );
    }

    // Callers can skip the review gate either because the org has opted in
    // to unrestricted REST API writes, or because their token/role grants
    // the bypassApprovalChecks permission for this feature's project.
    const canBypass =
      !!req.context.org.settings?.restApiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);

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
    const revisedRules: RevisionRules = {};
    Object.entries(feature.environmentSettings).forEach(([env, settings]) => {
      revisedRules[env] = settings.rules;
    });
    const changedRuleEnvironments: string[] = [];
    let defaultValueChanged = false;

    if (
      updates.defaultValue !== undefined &&
      updates.defaultValue !== feature.defaultValue
    ) {
      defaultValueChanged = true;
    }
    if (updates.environmentSettings) {
      Object.entries(updates.environmentSettings).forEach(([env, settings]) => {
        if (
          !isEqual(
            settings.rules,
            feature.environmentSettings?.[env]?.rules || [],
          )
        ) {
          changedRuleEnvironments.push(env);
          revisedRules[env] = settings.rules;
        }
      });
    }

    // 3. metadata
    const metadataChanges: Record<string, unknown> = {};
    const metadataFields = [
      "owner",
      "description",
      "project",
      "tags",
      "customFields",
      "jsonSchema",
    ] as const;
    for (const key of metadataFields) {
      if (key in updates && updates[key] !== undefined) {
        metadataChanges[key] = updates[key];
        delete (updates as Record<string, unknown>)[key];
      }
    }

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
              rules: revisedRules,
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
      version: updatedFeature.version,
    });
    const safeRolloutMap =
      await req.context.models.safeRollout.getAllPayloadSafeRollouts();
    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
        safeRolloutMap,
      }),
    };
  },
);
