import { z } from "zod";
import { validateFeatureValue } from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { PostFeatureResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postFeatureValidator } from "back-end/src/validators/openapi";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { FeatureInterface, JSONSchemaDef } from "back-end/types/feature";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  addIdsToRules,
  createInterfaceEnvSettingsFromApiEnvSettings,
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { OrganizationInterface } from "back-end/types/organization";
import { getEnvironments } from "back-end/src/services/organizations";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTags } from "back-end/src/models/TagModel";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";

export type ApiFeatureEnvSettings = NonNullable<
  z.infer<typeof postFeatureValidator.bodySchema>["environments"]
>;

export type ApiFeatureEnvSettingsRules = ApiFeatureEnvSettings[keyof ApiFeatureEnvSettings]["rules"];

export const validateEnvKeys = (
  orgEnvKeys: string[],
  incomingEnvKeys: string[]
) => {
  const invalidEnvKeys = incomingEnvKeys.filter((k) => !orgEnvKeys.includes(k));

  if (invalidEnvKeys.length) {
    throw new Error(
      `Environment key(s) '${invalidEnvKeys.join(
        "', '"
      )}' not recognized. Please create the environment or remove it from your environment settings and try again.`
    );
  }
};

export const parseJsonSchemaForEnterprise = (
  org: OrganizationInterface,
  jsonSchema: string | undefined
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
    // eslint-disable-next-line no-console
    console.error("failed to parse json schema", e);
    return jsonSchemaWrapper;
  }
};

export const postFeature = createApiRequestHandler(postFeatureValidator)(
  async (req): Promise<PostFeatureResponse> => {
    if (!req.context.permissions.canCreateFeature(req.body)) {
      req.context.permissions.throwPermissionError();
    }

    const existing = await getFeature(req.context, req.body.id);
    if (existing) {
      throw new Error(`Feature id '${req.body.id}' already exists.`);
    }

    if (!req.body.id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
      throw new Error(
        "Feature keys can only include letters, numbers, hyphens, and underscores."
      );
    }

    const orgEnvs = getEnvironments(req.context.org);

    // ensure environment keys are valid
    validateEnvKeys(
      orgEnvs.map((e) => e.id),
      Object.keys(req.body.environments ?? {})
    );

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
        throw new Error(
          `Project id ${req.body.project} is not a valid project.`
        );
      }
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
            if (rule.type === "safe-rollout") {
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
            }
          }
        }
      }
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
    };

    const environmentSettings = createInterfaceEnvSettingsFromApiEnvSettings(
      feature,
      orgEnvs,
      req.body.environments ?? {}
    );

    feature.environmentSettings = environmentSettings;

    const jsonSchema = parseJsonSchemaForEnterprise(
      req.context.org,
      req.body.jsonSchema
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
            orgEnvs.map((e) => e.id)
          )
        )
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

    const groupMap = await getSavedGroupMap(req.organization);

    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id
    );
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
      }),
    };
  }
);
