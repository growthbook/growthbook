import { z } from "zod";
import { PostFeatureResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postFeatureValidator } from "../../validators/openapi";
import { createFeature, getFeature } from "../../models/FeatureModel";
import { FeatureInterface } from "../../../types/feature";
import { getEnabledEnvironments } from "../../util/features";
import {
  addIdsToRules,
  fromApiEnvSettingsToFeatureEnvSettings,
  getApiFeatureObj,
  getSavedGroupMap,
} from "../../services/features";
import { auditDetailsCreate } from "../../services/audit";

export type ApiFeatureEnvSettings = NonNullable<
  z.infer<typeof postFeatureValidator.bodySchema>["environments"]
>;

export type ApiFeatureEnvSettingsRules = ApiFeatureEnvSettings[keyof ApiFeatureEnvSettings]["rules"];

const validateEnvKeys = (orgEnvKeys: string[], incomingEnvKeys: string[]) => {
  const invalidEnvKeys = incomingEnvKeys.filter((k) => !orgEnvKeys.includes(k));

  if (invalidEnvKeys.length) {
    throw new Error(
      `Environment key(s) '${invalidEnvKeys.join(
        "', '"
      )}' not recognized. Please create the environment or remove it from your environment settings and try again.`
    );
  }
};

const validateDefaultValueType = (
  valueType: z.infer<typeof postFeatureValidator.bodySchema>["valueType"],
  defaultValue: z.infer<typeof postFeatureValidator.bodySchema>["defaultValue"]
) => {
  const defaultValueType = typeof defaultValue;
  switch (valueType) {
    case "string":
    case "number":
    case "boolean":
      if (defaultValueType !== valueType)
        throw new Error(
          `Type mismatch between valueType ('${valueType}') and defaultValue ('${defaultValueType}').`
        );
      break;
    case "json":
      if (defaultValueType === "object") return;
      if (defaultValueType === "string") {
        try {
          const json = JSON.parse(defaultValue);
          // check against valid json that doesn't produce an object
          // e.g. JSON.parse('false')
          if (typeof json !== "object") throw new Error("not json obj");
        } catch (e) {
          throw new Error(`defaultValue is not valid JSON.`);
        }
      } else {
        throw new Error(
          "Values of type 'json' must be provided in string or object format."
        );
      }
      break;
    default:
      throw new Error(`Invalid valueType ('${valueType}').`);
  }
};

export const postFeature = createApiRequestHandler(postFeatureValidator)(
  async (req): Promise<PostFeatureResponse> => {
    req.checkPermissions("manageFeatures", req.body.project);

    const existing = await getFeature(req.organization.id, req.body.id);
    if (existing) {
      throw new Error(`Feature id '${req.body.id}' already exists.`);
    }

    const orgEnvs = req.organization.settings?.environments || [];

    // ensure environment keys are valid
    validateEnvKeys(
      orgEnvs.map((e) => e.id),
      Object.keys(req.body.environments ?? {})
    );

    // ensure default value matches value type
    validateDefaultValueType(req.body.valueType, req.body.defaultValue);

    const environmentSettings = fromApiEnvSettingsToFeatureEnvSettings(
      orgEnvs,
      req.body.environments ?? {}
    );

    const defaultValue =
      req.body.valueType === "json" && typeof req.body.defaultValue === "object"
        ? JSON.stringify(req.body.defaultValue)
        : req.body.defaultValue ?? "";

    const feature: FeatureInterface = {
      defaultValue,
      valueType: req.body.valueType,
      owner: req.body.owner,
      description: req.body.description || "",
      project: req.body.project || "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: req.organization.id,
      id: req.body.id.toLowerCase(),
      archived: req.body.archived || false,
      revision: {
        version: 1,
        comment: "New feature",
        date: new Date(),
        publishedBy: {
          id: req.body.owner,
          email: req.body.owner,
          name: req.body.owner,
        },
      },
      jsonSchema: {
        schema: "",
        date: new Date(),
        enabled: false,
      },
      environmentSettings,
    };

    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature)
    );

    addIdsToRules(feature.environmentSettings, feature.id);

    await createFeature(req.organization, req.eventAudit, feature);

    await req.audit({
      event: "feature.create",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsCreate(feature),
    });

    const groupMap = await getSavedGroupMap(req.organization);

    return {
      feature: getApiFeatureObj(feature, req.organization, groupMap),
    };
  }
);
