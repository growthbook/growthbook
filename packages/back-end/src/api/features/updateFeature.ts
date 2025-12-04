import {
  featureRequiresReview,
  validateFeatureValue,
  validateScheduleRules,
} from "shared/util";
import { isEqual } from "lodash";
import { UpdateFeatureResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateFeatureValidator } from "back-end/src/validators/openapi";
import {
  getFeature,
  updateFeature as updateFeatureToDb,
} from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  addIdsToRules,
  getApiFeatureObj,
  getSavedGroupMap,
  updateInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import { FeatureInterface } from "back-end/types/feature";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { RevisionRules } from "back-end/src/validators/features";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validation";

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
    if (customFields) {
      await validateCustomFields(customFields, req.context, req.body.project);
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

    // Create a revision for the changes and publish them immediately
    let defaultValueChanged = false;
    const changedEnvironments: string[] = [];
    if ("defaultValue" in updates || "environmentSettings" in updates) {
      const revisionChanges: Partial<FeatureRevisionInterface> = {};
      const revisedRules: RevisionRules = {};

      // Copy over current envSettings to revision as this endpoint support partial updates
      Object.entries(feature.environmentSettings).forEach(([env, settings]) => {
        revisedRules[env] = settings.rules;
      });

      let hasChanges = false;
      if (
        "defaultValue" in updates &&
        updates.defaultValue !== feature.defaultValue
      ) {
        revisionChanges.defaultValue = updates.defaultValue;
        hasChanges = true;
        defaultValueChanged = true;
      }
      if (updates.environmentSettings) {
        Object.entries(updates.environmentSettings).forEach(
          ([env, settings]) => {
            if (
              !isEqual(
                settings.rules,
                feature.environmentSettings?.[env]?.rules || [],
              )
            ) {
              hasChanges = true;
              changedEnvironments.push(env);
              // if the rule is different from the current feature value, update revisionChanges
              revisedRules[env] = settings.rules;
            }
          },
        );
      }

      revisionChanges.rules = revisedRules;

      if (hasChanges) {
        const reviewRequired = featureRequiresReview(
          feature,
          changedEnvironments,
          defaultValueChanged,
          req.organization.settings,
        );
        if (reviewRequired) {
          if (!req.context.permissions.canBypassApprovalChecks(feature)) {
            throw new Error(
              "This feature requires a review and the API key being used does not have permission to bypass reviews.",
            );
          }
        }

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
          canBypassApprovalChecks: true,
        });
        updates.version = revision.version;
      }
    }

    const updatedFeature = await updateFeatureToDb(
      req.context,
      feature,
      updates,
    );

    await addTagsDiff(
      req.context.org.id,
      feature.tags || [],
      updates.tags || [],
    );

    await req.audit({
      event: "feature.update",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature),
    });

    const groupMap = await getSavedGroupMap(req.organization);

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
      await req.context.models.safeRollout.getPayloadMapByFeatureId(
        updatedFeature.id,
      );
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
