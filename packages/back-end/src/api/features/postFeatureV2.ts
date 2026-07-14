import { validateFeatureValue } from "shared/util";
import { postFeatureV2Validator } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerEmail,
  resolveOwnerForCreate,
} from "back-end/src/services/owner";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  getEnabledEnvironments,
  validateEnvKeys,
  validateAndNormalizeDefaultValueOverrides,
} from "back-end/src/util/features";
import {
  addIdsToFlatRules,
  createInterfaceEnvSettingsFromApiEnvSettings,
  getApiFeatureObjV2,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/services/organizations";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTags } from "back-end/src/models/TagModel";
import { parseApiJsonSchema } from "back-end/src/util/feature-json-schema";
import type { ApiFeatureEnvSettings } from "./postFeature";
import { validateCustomFields, validateRuleAttributes } from "./validations";
import { assertValidProjectId, mapV2ApiRuleToFeatureRule } from "./v2Shared";

export const postFeatureV2 = createApiRequestHandler(postFeatureV2Validator)(
  async (req) => {
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

    validateEnvKeys(
      orgEnvs.map((e) => e.id),
      Object.keys(req.body.environments ?? {}),
    );

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

    feature.environmentSettings = createInterfaceEnvSettingsFromApiEnvSettings(
      feature,
      orgEnvs,
      (req.body.environments ?? {}) as ApiFeatureEnvSettings,
    );

    // Opt-in registered-attribute check before any DB writes. The env-rules
    // path runs the same check inside `fromApiEnvSettingsRulesToFeatureEnvSettingsRules`,
    // but flat v2 rules go through `mapV2ApiRuleToFeatureRule` which doesn't
    // validate, so we cover them explicitly here.
    for (const rule of req.body.rules ?? []) {
      validateRuleAttributes(
        rule as Parameters<typeof validateRuleAttributes>[0],
        req.context,
        req.body.project,
      );
    }

    feature.rules = (req.body.rules ?? []).map((rule) =>
      mapV2ApiRuleToFeatureRule(rule),
    );

    const jsonSchema = parseApiJsonSchema(
      req.context.org,
      req.body.jsonSchema,
      feature.valueType,
    );
    feature.jsonSchema = jsonSchema;
    feature.defaultValue = validateFeatureValue(feature, feature.defaultValue);

    if (req.body.defaultValueOverrides !== undefined) {
      feature.defaultValueOverrides = validateAndNormalizeDefaultValueOverrides(
        feature,
        req.body.defaultValueOverrides,
        orgEnvs.map((e) => e.id),
      );
    }

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

    addIdsToFlatRules(feature.rules, feature.id);

    await createFeature(req.context, feature);

    await req.audit({
      event: "feature.create",
      entity: { object: "feature", id: feature.id },
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
        getApiFeatureObjV2({
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
  },
);
