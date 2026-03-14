import {
  checkIfRevisionNeedsReview,
  validateFeatureValue,
  validateScheduleRules,
} from "shared/util";
import { isEqual } from "lodash";
import type { UpdateFeatureResponse } from "shared/types/openapi";
import { updateFeatureValidator, RevisionRules } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
  applyRevisionChanges,
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
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validations";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req): Promise<UpdateFeatureResponse> => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const { owner, archived, description, project, tags, customFields } =
      req.body;

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

    const jsonSchema =
      feature.valueType === "json" && req.body.jsonSchema != null
        ? parseJsonSchemaForEnterprise(req.organization, req.body.jsonSchema)
        : null;

    const updates: Partial<FeatureInterface> = {
      ...(owner != null ? { owner } : {}),
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

    const apiBypassesReviews =
      req.context.org.settings?.restApiBypassesReviews !== false;
    const canBypass =
      apiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);

    // Capture tags before stripping them from updates (they go into the revision
    // metadata but updateFeatureToDb doesn't need them directly).
    const newTagsForDiff = updates.tags;

    // --- Build a single combined revision for all change types ---

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
          // Neutralise enabled in the direct-write path so it isn't applied twice.
          updates.environmentSettings[env] = {
            ...updates.environmentSettings[env],
            enabled: feature.environmentSettings?.[env]?.enabled ?? true,
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
    if (newPrerequisites) {
      delete updates.prerequisites;
    }

    // Determine whether any revision-tracked change exists
    const hasEnvEnabledChanges = Object.keys(changedEnvEnabled).length > 0;
    const hasRuleChanges =
      defaultValueChanged || changedRuleEnvironments.length > 0;
    const hasMetadataChanges = Object.keys(metadataChanges).length > 0;
    const hasPrereqChanges = newPrerequisites !== null;

    const hasRevisionChanges =
      hasEnvEnabledChanges ||
      hasRuleChanges ||
      hasMetadataChanges ||
      hasPrereqChanges;

    if (hasRevisionChanges) {
      // Build a combined revision object for the approval check.
      const liveRevision = await getRevision({
        context: req.context,
        organization: feature.organization,
        featureId: feature.id,
        version: feature.version,
      });
      if (!liveRevision) throw new Error("Could not load live revision");

      const combinedRevision: FeatureRevisionInterface = {
        ...liveRevision,
        ...(hasEnvEnabledChanges
          ? { environmentsEnabled: changedEnvEnabled }
          : {}),
        ...(hasRuleChanges
          ? {
              defaultValue: updates.defaultValue ?? liveRevision.defaultValue,
              rules: revisedRules,
            }
          : {}),
        ...(hasMetadataChanges ? { metadata: metadataChanges } : {}),
        ...(hasPrereqChanges ? { prerequisites: newPrerequisites } : {}),
      };

      const reviewRequired = checkIfRevisionNeedsReview({
        feature,
        baseRevision: liveRevision,
        revision: combinedRevision,
        allEnvironments: orgEnvs,
        settings: req.organization.settings,
      });

      if (reviewRequired && !canBypass) {
        throw new Error(
          "This feature requires a review and the API key being used does not have permission to bypass reviews.",
        );
      }

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
      };

      const revision = await createRevision({
        context: req.context,
        feature,
        user: req.eventAudit,
        baseVersion: feature.version,
        comment: "Created via REST API",
        environments: orgEnvs,
        publish: true,
        changes: revisionChanges,
        org: req.organization,
        canBypassApprovalChecks: canBypass,
      });

      // Build a MergeResultChanges-compatible object for applyRevisionChanges.
      const mergeResult = {
        ...(hasEnvEnabledChanges
          ? { environmentsEnabled: changedEnvEnabled }
          : {}),
        ...(defaultValueChanged ? { defaultValue: updates.defaultValue } : {}),
        ...(changedRuleEnvironments.length > 0 ? { rules: revisedRules } : {}),
        ...(hasMetadataChanges ? { metadata: metadataChanges } : {}),
        ...(hasPrereqChanges ? { prerequisites: newPrerequisites } : {}),
      };

      const updatedFeatureFromRevision = await applyRevisionChanges(
        req.context,
        feature,
        revision,
        mergeResult,
      );
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
