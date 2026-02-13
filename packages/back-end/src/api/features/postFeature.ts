import { z } from "zod";
import { validateFeatureValue, validateScheduleRules } from "shared/util";
import { PostFeatureResponse } from "shared/types/openapi";
import { postFeatureValidator } from "shared/validators";
import { FeatureInterface, JSONSchemaDef } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  addIdsToRules,
  createInterfaceEnvSettingsFromApiEnvSettings,
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/services/organizations";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTags } from "back-end/src/models/TagModel";
import { logger } from "back-end/src/util/logger";
import { validateCustomFields } from "./validation.js";

export type ApiFeatureEnvSettings = NonNullable<
  z.infer<typeof postFeatureValidator.bodySchema>["environments"]
>;

export type ApiFeatureEnvSettingsRules =
  ApiFeatureEnvSettings[keyof ApiFeatureEnvSettings]["rules"];

export const validateEnvKeys = (
  orgEnvKeys: string[],
  incomingEnvKeys: string[],
) => {
  const invalidEnvKeys = incomingEnvKeys.filter((k) => !orgEnvKeys.includes(k));

  if (invalidEnvKeys.length) {
    throw new Error(
      `Environment key(s) '${invalidEnvKeys.join(
        "', '",
      )}' not recognized. Please create the environment or remove it from your environment settings and try again.`,
    );
  }
};

export const parseJsonSchemaForEnterprise = (
  org: OrganizationInterface,
  jsonSchema: string | undefined,
) => {
  const jsonSchemaWrapper: JSONSchemaDef = {
    schemaType: "schema",
    schema: "",
    simple: { type: "object", fields: [] },
    date: new Date(),
    enabled: false,
  };
  if (!jsonSchema) return jsonSchemaWrapper;
  if (!orgHasPremiumFeature(org, "json-validation")) return jsonSchemaWrapper;
  try {
    // ensure the schema is valid JSON
    jsonSchemaWrapper.schema = JSON.stringify(JSON.parse(jsonSchema));
    jsonSchemaWrapper.enabled = true;
    return jsonSchemaWrapper;
  } catch (e) {
    logger.error(e, "Failed to parse feature json schema");
    return jsonSchemaWrapper;
  }
};

export const postFeature = createApiRequestHandler(postFeatureValidator)(async (
  req,
): Promise<PostFeatureResponse> => {
  if (!req.context.permissions.canCreateFeature(req.body)) {
    req.context.permissions.throwPermissionError();
  }

  const existing = await getFeature(req.context, req.body.id);
  if (existing) {
    throw new Error(`Feature id '${req.body.id}' already exists.`);
  }

  if (!req.body.id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores.",
    );
  }

  const orgEnvs = getEnvironments(req.context.org);

  // ensure environment keys are valid
  validateEnvKeys(
    orgEnvs.map((e) => e.id),
    Object.keys(req.body.environments ?? {}),
  );

  // Validate scheduleRules before processing environment settings
  if (req.body.environments) {
    Object.entries(req.body.environments).forEach(([envName, envSettings]) => {
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
    });
  }

  if (
    req.context.org.settings?.requireProjectForFeatures &&
    !req.body.project
  ) {
    throw new Error("Must specify a project for new features");
  }

  // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
  if (req.body.project) {
    const projects = await req.context.getProjects();
    if (!projects.some((p) => p.id === req.body.project)) {
      throw new Error(`Project id ${req.body.project} is not a valid project.`);
    }
  }

  // check if the custom fields are valid
  if (req.body.customFields) {
    await validateCustomFields(
      req.body.customFields,
      req.context,
      req.body.project,
    );
  }

  const tags = req.body.tags || [];

  if (tags.length > 0) {
    await addTags(req.context.org.id, tags);
  }

  const feature: FeatureInterface = {
    defaultValue: req.body.defaultValue ?? "",
    valueType: req.body.valueType,
    owner: req.body.owner,
    description: req.body.description || "",
    project: req.body.project || "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: req.context.org.id,
    id: req.body.id,
    archived: !!req.body.archived,
    version: 1,
    environmentSettings: {},
    prerequisites: (req.body?.prerequisites || []).map((p) => ({
      id: p,
      condition: `{"value": true}`,
    })),
    tags,
    customFields: req.body.customFields,
  };

  const environmentSettings = createInterfaceEnvSettingsFromApiEnvSettings(
    feature,
    orgEnvs,
    req.body.environments ?? {},
  );

  feature.environmentSettings = environmentSettings;

  const jsonSchema = parseJsonSchemaForEnterprise(
    req.context.org,
    req.body.jsonSchema,
  );

  feature.jsonSchema = jsonSchema;

  // ensure default value matches value type
  feature.defaultValue = validateFeatureValue(feature, feature.defaultValue);

  if (
    !req.context.permissions.canPublishFeature(
      feature,
      Array.from(
        getEnabledEnvironments(
          feature,
          orgEnvs.map((e) => e.id),
        ),
      ),
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  addIdsToRules(feature.environmentSettings, feature.id);

  await createFeature(req.context, feature);

  await req.audit({
    event: "feature.create",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsCreate(feature),
  });

  const groupMap = await getSavedGroupMap(req.context);

  const experimentMap = await getExperimentMapForFeature(
    req.context,
    feature.id,
  );
  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();
  const revision = await getRevision({
    context: req.context,
    organization: feature.organization,
    featureId: feature.id,
    version: feature.version,
  });

  return {
    feature: getApiFeatureObj({
      feature,
      organization: req.organization,
      groupMap,
      experimentMap,
      revision,
      safeRolloutMap,
    }),
  };
});
