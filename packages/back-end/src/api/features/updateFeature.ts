import { featureRequiresReview, validateFeatureValue } from "shared/util";
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
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";

export const updateFeature = createApiRequestHandler(updateFeatureValidator)(
  async (req): Promise<UpdateFeatureResponse> => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error(`Feature id '${req.params.id}' not found.`);
    }

    const { owner, archived, description, project, tags } = req.body;

    const effectiveProject =
      typeof project === "undefined" ? feature.project : project;

    const orgEnvs = getEnvironmentIdsFromOrg(req.organization);

    if (!req.context.permissions.canUpdateFeature(feature, req.body)) {
      req.context.permissions.throwPermissionError();
    }

    if (project != null) {
      if (
        !req.context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, orgEnvs))
        ) ||
        !req.context.permissions.canPublishFeature(
          { project },
          Array.from(getEnabledEnvironments(feature, orgEnvs))
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
          `Project id ${req.body.project} is not a valid project.`
        );
      }
    }

    // ensure environment keys are valid
    if (req.body.environments != null) {
      validateEnvKeys(orgEnvs, Object.keys(req.body.environments ?? {}));
    }

    // ensure default value matches value type
    let defaultValue;
    if (req.body.defaultValue != null) {
      defaultValue = validateFeatureValue(feature, req.body.defaultValue);
    }

    // Check if the user has any safe rollout rules and if they have the premium feature if they do
    const hasSafeRollout = Object.values(
      req.body.environments ?? {}
    ).some((env) =>
      Object.values(env.rules ?? {}).some(
        (rule) => rule.type === "safe-rollout"
      )
    );

    if (hasSafeRollout && !req.context.hasPremiumFeature("safe-rollout")) {
      throw new Error("Safe Rollout rules are a premium feature.");
    } else if (hasSafeRollout && req.body.environments) {
      // loop through the environments and rules and validate safe-rollout rules
      const envKeys = Object.keys(req.body.environments);
      for (const envKey of envKeys) {
        const env = req.body.environments[envKey];
        if (env.rules) {
          for (const rule of env.rules) {
            if (
              rule.type === "safe-rollout" &&
              !rule.safeRolloutId &&
              !rule.id
            ) {
              const safeRolloutFields = {
                maxDuration: {
                  amount: rule.maxDuration,
                  unit: "days" as const, // Change to passed in unit once we supports units other than days
                },
                exposureQueryId: rule.exposureQueryId,
                datasourceId: rule.datasourceId,
                guardrailMetricIds: rule.guardrailMetricIds,
              };
              // validate the safe rollout fields
              const validatedFields = await validateCreateSafeRolloutFields(
                safeRolloutFields,
                req.context
              );

              const safeRollout = await req.context.models.safeRollout.create({
                ...validatedFields,
                environment: envKey,
                featureId: rule.featureId,
                status: rule.status ?? "running",
                autoSnapshots: true,
              });

              if (!safeRollout) {
                throw new Error("Failed to create safe rollout");
              }

              rule.safeRolloutId = safeRollout.id;
            } else if (rule.type === "safe-rollout" && rule.id) {
              throw new Error(
                "Safe Rollout rules cannot be updated via the API."
              );
            }
          }
        }
      }
    }

    const environmentSettings =
      req.body.environments != null
        ? updateInterfaceEnvSettingsFromApiEnvSettings(
            feature,
            req.body.environments
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
              orgEnvs
            )
          )
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
                feature.environmentSettings?.[env]?.rules || []
              )
            ) {
              hasChanges = true;
              changedEnvironments.push(env);
              revisionChanges.rules = revisionChanges.rules || {};
              revisionChanges.rules[env] = settings.rules;
            }
          }
        );
      }

      if (hasChanges) {
        const reviewRequired = featureRequiresReview(
          feature,
          changedEnvironments,
          defaultValueChanged,
          req.organization.settings
        );
        if (reviewRequired) {
          if (!req.context.permissions.canBypassApprovalChecks(feature)) {
            throw new Error(
              "This feature requires a review and the API key being used does not have permission to bypass reviews."
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
      updates
    );

    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      updates.tags || []
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
      feature.id
    );
    const revision = await getRevision({
      context: req.context,
      organization: updatedFeature.organization,
      featureId: updatedFeature.id,
      version: updatedFeature.version,
    });
    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
      }),
    };
  }
);
