import {
  featureRequiresReview,
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

    // All envelope changes (environmentsEnabled, prerequisites) always go through a revision.
    // Check if the affected environments require review.
    const canBypass =
      apiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);

    // Handle environmentsEnabled (kill switch changes) — always via revision
    if (updates.environmentSettings) {
      const changedEnvEnabled: Record<string, boolean> = {};
      for (const [env, settings] of Object.entries(
        updates.environmentSettings,
      )) {
        if (
          typeof settings.enabled === "boolean" &&
          settings.enabled !== feature.environmentSettings?.[env]?.enabled
        ) {
          changedEnvEnabled[env] = settings.enabled;
          // Keep current enabled state in the direct write so it is not applied twice
          updates.environmentSettings[env] = {
            ...updates.environmentSettings[env],
            enabled: feature.environmentSettings?.[env]?.enabled ?? true,
          };
        }
      }
      if (Object.keys(changedEnvEnabled).length > 0) {
        const liveRevision = await (
          await import("back-end/src/models/FeatureRevisionModel")
        ).getRevision({
          context: req.context,
          organization: feature.organization,
          featureId: feature.id,
          version: feature.version,
        });
        if (!liveRevision) throw new Error("Could not load live revision");
        const fakeRevision = {
          ...liveRevision,
          environmentsEnabled: changedEnvEnabled,
        };
        const reviewRequired = checkIfRevisionNeedsReview({
          feature,
          baseRevision: liveRevision,
          revision: fakeRevision,
          allEnvironments: orgEnvs,
          settings: req.organization.settings,
        });
        if (reviewRequired && !canBypass) {
          throw new Error(
            "This feature requires a review for kill switch changes and the API key being used does not have permission to bypass reviews.",
          );
        }
        const envEnabledRevision = await createRevision({
          context: req.context,
          feature,
          user: req.eventAudit,
          baseVersion: feature.version,
          comment: "Created via REST API",
          environments: orgEnvs,
          publish: true,
          changes: { environmentsEnabled: changedEnvEnabled },
          org: req.organization,
          canBypassApprovalChecks: canBypass,
        });
        const featureWithToggle = await (
          await import("back-end/src/models/FeatureModel")
        ).applyRevisionChanges(req.context, feature, envEnabledRevision, {
          environmentsEnabled: changedEnvEnabled,
        });
        Object.assign(feature, featureWithToggle);
        updates.version = envEnabledRevision.version;
      }
    }

    // prerequisites — always via revision
    if (updates.prerequisites) {
      const liveRevision2 = await (
        await import("back-end/src/models/FeatureRevisionModel")
      ).getRevision({
        context: req.context,
        organization: feature.organization,
        featureId: feature.id,
        version: feature.version,
      });
      if (!liveRevision2) throw new Error("Could not load live revision");
      const fakeRevision2 = {
        ...liveRevision2,
        prerequisites: updates.prerequisites,
      };
      const reviewRequired2 = checkIfRevisionNeedsReview({
        feature,
        baseRevision: liveRevision2,
        revision: fakeRevision2,
        allEnvironments: orgEnvs,
        settings: req.organization.settings,
      });
      if (reviewRequired2 && !canBypass) {
        throw new Error(
          "This feature requires a review for prerequisite changes and the API key being used does not have permission to bypass reviews.",
        );
      }
      const prereqRevision = await createRevision({
        context: req.context,
        feature,
        user: req.eventAudit,
        baseVersion: feature.version,
        comment: "Created via REST API",
        environments: orgEnvs,
        publish: true,
        changes: { prerequisites: updates.prerequisites },
        org: req.organization,
        canBypassApprovalChecks: canBypass,
      });
      const featureWithPrereqs = await (
        await import("back-end/src/models/FeatureModel")
      ).applyRevisionChanges(req.context, feature, prereqRevision, {
        prerequisites: updates.prerequisites,
      });
      Object.assign(feature, featureWithPrereqs);
      updates.version = prereqRevision.version;
      delete updates.prerequisites;
    }

    // metadata — always via revision
    // Capture tags before they get moved into metadataChanges and deleted from updates.
    const newTagsForDiff = updates.tags;
    {
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
      if (Object.keys(metadataChanges).length > 0) {
        const liveRevision3 = await (
          await import("back-end/src/models/FeatureRevisionModel")
        ).getRevision({
          context: req.context,
          organization: feature.organization,
          featureId: feature.id,
          version: feature.version,
        });
        if (!liveRevision3) throw new Error("Could not load live revision");
        const fakeRevision3 = { ...liveRevision3, metadata: metadataChanges };
        const reviewRequired3 = checkIfRevisionNeedsReview({
          feature,
          baseRevision: liveRevision3,
          revision: fakeRevision3,
          allEnvironments: orgEnvs,
          settings: req.organization.settings,
        });
        if (reviewRequired3 && !canBypass) {
          throw new Error(
            "This feature requires a review for metadata changes and the API key being used does not have permission to bypass reviews.",
          );
        }
        const metaRevision = await createRevision({
          context: req.context,
          feature,
          user: req.eventAudit,
          baseVersion: feature.version,
          comment: "Created via REST API",
          environments: orgEnvs,
          publish: true,
          changes: { metadata: metadataChanges },
          org: req.organization,
          canBypassApprovalChecks: canBypass,
        });
        const featureWithMeta = await (
          await import("back-end/src/models/FeatureModel")
        ).applyRevisionChanges(req.context, feature, metaRevision, {
          metadata: metadataChanges,
        });
        Object.assign(feature, featureWithMeta);
        updates.version = metaRevision.version;
      }
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
