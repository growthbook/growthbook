import { validateScheduleRules, validateFeatureValue } from "shared/util";
import omit from "lodash/omit";
import { postFeatureRevisionValidator } from "shared/validators";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createRevision } from "back-end/src/models/FeatureRevisionModel";
import { updateInterfaceEnvSettingsFromApiEnvSettings } from "back-end/src/services/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { shouldValidateCustomFieldsOnUpdate } from "back-end/src/util/custom-fields";
import { parseJsonSchemaForEnterprise, validateEnvKeys } from "./postFeature";
import { validateCustomFields } from "./validations";

export const postFeatureRevision = createApiRequestHandler(
  postFeatureRevisionValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new Error(`Feature id '${req.params.id}' not found.`);
  }

  if (!req.context.permissions.canUpdateFeature(feature, req.body)) {
    req.context.permissions.throwPermissionError();
  }
  if (!req.context.permissions.canManageFeatureDrafts(feature)) {
    req.context.permissions.throwPermissionError();
  }

  const orgEnvs = getEnvironmentIdsFromOrg(req.context.org);

  if (req.body.environments != null) {
    validateEnvKeys(orgEnvs, Object.keys(req.body.environments));

    Object.entries(req.body.environments).forEach(([envName, envSettings]) => {
      envSettings.rules?.forEach((rule, ruleIndex) => {
        if (rule.scheduleRules) {
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
    });
  }

  if (req.body.holdout !== undefined && req.body.holdout !== null) {
    const holdoutObj = await req.context.models.holdout.getById(
      req.body.holdout.id,
    );
    if (!holdoutObj) {
      throw new Error(`Holdout id '${req.body.holdout.id}' not found.`);
    }
  }

  // Validate custom fields if they (or the project) changed.
  const projectChanged =
    req.body.project !== undefined && req.body.project !== feature.project;
  const customFieldsChanged = shouldValidateCustomFieldsOnUpdate({
    existingCustomFieldValues: feature.customFields,
    updatedCustomFieldValues: req.body.customFields,
  });
  if (projectChanged || customFieldsChanged) {
    await validateCustomFields(
      req.body.customFields ?? feature.customFields,
      req.context,
      req.body.project ?? feature.project,
    );
  }

  // Build per-env rules + enabled state from the API payload, then split into
  // the rules-per-env / enabled-per-env shape that revisions store.
  const environmentSettings =
    req.body.environments != null
      ? updateInterfaceEnvSettingsFromApiEnvSettings(
          feature,
          req.body.environments,
        )
      : null;

  const changes: Partial<FeatureRevisionInterface> = {};

  if (req.body.defaultValue !== undefined) {
    changes.defaultValue = validateFeatureValue(feature, req.body.defaultValue);
  }

  if (environmentSettings) {
    const rules: Record<string, FeatureRevisionInterface["rules"][string]> = {};
    const environmentsEnabled: Record<string, boolean> = {};
    for (const [env, envSettings] of Object.entries(environmentSettings)) {
      rules[env] = envSettings.rules;
      if (typeof envSettings.enabled === "boolean") {
        environmentsEnabled[env] = envSettings.enabled;
      }
    }
    if (Object.keys(rules).length) changes.rules = rules;
    if (Object.keys(environmentsEnabled).length) {
      changes.environmentsEnabled = environmentsEnabled;
    }
  }

  if (req.body.prerequisites !== undefined) {
    changes.prerequisites = req.body.prerequisites.map((p) => ({
      id: p,
      condition: `{"value": true}`,
    }));
  }

  if (req.body.archived !== undefined) {
    changes.archived = req.body.archived;
  }

  if ("holdout" in req.body) {
    changes.holdout = req.body.holdout ?? null;
  }

  // Metadata fields go into revision.metadata.
  const metadata: Record<string, unknown> = {};
  if (req.body.description !== undefined)
    metadata.description = req.body.description;
  if (req.body.owner !== undefined) metadata.owner = req.body.owner;
  if (req.body.project !== undefined) metadata.project = req.body.project;
  if (req.body.tags !== undefined) metadata.tags = req.body.tags;
  if (req.body.customFields !== undefined) {
    metadata.customFields = req.body.customFields;
  }
  if (req.body.jsonSchema !== undefined && feature.valueType === "json") {
    metadata.jsonSchema = parseJsonSchemaForEnterprise(
      req.organization,
      req.body.jsonSchema,
    );
  }
  if (Object.keys(metadata).length) {
    changes.metadata = metadata as FeatureRevisionInterface["metadata"];
  }

  const revision = await createRevision({
    context: req.context,
    feature,
    user: req.eventAudit,
    baseVersion: feature.version,
    environments: orgEnvs,
    publish: false,
    comment: req.body.comment ?? "Created via REST API",
    title: req.body.title,
    changes,
    org: req.organization,
    canBypassApprovalChecks: false,
  });

  return {
    revision: omit(revision, "organization"),
  };
});
