import { z } from "zod";
import { validateFeatureValue } from "shared/util";
import { postFeatureValidator } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerForCreate,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  addIdsToFlatRules,
  addIdsToRules,
  buildFeatureRulesFromApiEnvSettings,
  createInterfaceEnvSettingsFromApiEnvSettings,
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/services/organizations";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTags } from "back-end/src/models/TagModel";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import { validateCustomFields } from "./validations";
import {
  assertValidProjectId,
  validateEnvRulesScheduleRules,
  assertValidBaseConfig,
  assertConfigSchemaCompat,
} from "./v2Shared";

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

export const postFeature = createApiRequestHandler(postFeatureValidator)(async (
  req,
) => {
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

  validateEnvRulesScheduleRules(req.body.environments, req.context);

  if (
    req.context.org.settings?.requireProjectForFeatures &&
    !req.body.project
  ) {
    throw new Error("Must specify a project for new features");
  }

  await assertValidProjectId(req.body.project, req.context);

  await validateCustomFields(
    req.body.customFields,
    req.context,
    req.body.project,
  );

  const tags = req.body.tags || [];

  if (tags.length > 0) {
    await addTags(req.context.org.id, tags);
  }

  const feature: FeatureInterface = {
    defaultValue: req.body.defaultValue ?? "",
    valueType: req.body.valueType,
    baseConfig: req.body.baseConfig ?? undefined,
    owner: await resolveOwnerForCreate(req.body.owner, req.context),
    description: req.body.description || "",
    project: req.body.project || "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: req.context.org.id,
    id: req.body.id,
    archived: !!req.body.archived,
    version: 1,
    environmentSettings: {},
    rules: [],
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
  // v2: rules live on feature.rules (flat array), sourced from the API's
  // per-env payload stamped with single-env scope.
  feature.rules = buildFeatureRulesFromApiEnvSettings(
    req.context,
    feature,
    orgEnvs,
    req.body.environments ?? {},
  );

  const jsonSchema = parseApiJsonSchema(
    req.context.org,
    req.body.jsonSchema,
    req.body.valueType,
  );

  feature.jsonSchema = jsonSchema;

  // Config mode: baseConfig must be a live config on a JSON flag, and can't
  // coexist with the flag's own JSON schema (the config's schema is authoritative).
  await assertValidBaseConfig(
    req.context,
    feature.baseConfig,
    feature.valueType,
    feature.project,
  );
  assertConfigSchemaCompat({
    jsonSchemaEnabled: feature.jsonSchema?.enabled,
    baseConfig: feature.baseConfig,
  });

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
  addIdsToFlatRules(feature.rules, feature.id);

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
    feature,
    version: feature.version,
  });
  return {
    feature: await resolveOwnerEmail(
      getApiFeatureObj({
        feature,
        organization: req.organization,
        groupMap,
        experimentMap,
        revision,
        safeRolloutMap,
      }),
      req.context,
    ),
  };
});
