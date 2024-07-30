import { z } from "zod";
import { validateFeatureValue } from "shared/util";
import { orgHasPremiumFeature } from "enterprise";
import { PostFeatureResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postFeatureValidator } from "../../validators/openapi";
import { createFeature, getFeature } from "../../models/FeatureModel";
import { getExperimentMapForFeature } from "../../models/ExperimentModel";
import { FeatureInterface, JSONSchemaDef } from "../../../types/feature";
import { getEnabledEnvironments } from "../../util/features";
import {
  addIdsToRules,
  createInterfaceEnvSettingsFromApiEnvSettings,
  getApiFeatureObj,
  getSavedGroupMap,
} from "../../services/features";
import { OrganizationInterface } from "../../../types/organization";
import { getEnvironments } from "../../services/organizations";
import { getRevision } from "../../models/FeatureRevisionModel";
import { addTags } from "../../models/TagModel";

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

    const orgEnvs = getEnvironments(req.context.org);

    // ensure environment keys are valid
    validateEnvKeys(
      orgEnvs.map((e) => e.id),
      Object.keys(req.body.environments ?? {})
    );

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

    const groupMap = await getSavedGroupMap(req.organization);

    const experimentMap = await getExperimentMapForFeature(
      req.context,
      feature.id
    );
    const revision = await getRevision(
      feature.organization,
      feature.id,
      feature.version
    );

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
