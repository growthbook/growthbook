import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import { MetricInterface } from "../../types/metric";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "../../types/datasource";
import SqlIntegration from "../integrations/SqlIntegration";
import { getSourceIntegrationObject } from "../services/datasource";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
import { MemberRole, OrganizationInterface } from "../../types/organization";
import { getConfigOrganizationSettings } from "../init/config";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "./secrets";

function roundVariationWeight(num: number): number {
  return Math.round(num * 1000) / 1000;
}
function getTotalVariationWeight(weights: number[]): number {
  return roundVariationWeight(weights.reduce((sum, w) => sum + w, 0));
}

// Adjusts an array of weights so it always sums to exactly 1
function adjustWeights(weights: number[]): number[] {
  const diff = getTotalVariationWeight(weights) - 1;
  const nDiffs = Math.round(Math.abs(diff) * 1000);
  return weights.map((v, i) => {
    const j = weights.length - i - 1;
    let d = 0;
    if (diff < 0 && i < nDiffs) d = 0.001;
    else if (diff > 0 && j < nDiffs) d = -0.001;
    return +(v + d).toFixed(3);
  });
}

export function upgradeMetricDoc(doc: MetricInterface): MetricInterface {
  const newDoc = { ...doc };

  if (doc.conversionDelayHours == null && doc.earlyStart) {
    newDoc.conversionDelayHours = -0.5;
    newDoc.conversionWindowHours =
      (doc.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) + 0.5;
  }

  if (!doc.userIdTypes?.length) {
    if (doc.userIdType === "user") {
      newDoc.userIdTypes = ["user_id"];
    } else if (doc.userIdType === "anonymous") {
      newDoc.userIdTypes = ["anonymous_id"];
    } else {
      newDoc.userIdTypes = ["anonymous_id", "user_id"];
    }
  }

  if (!doc.userIdColumns) {
    newDoc.userIdTypes?.forEach((type) => {
      let val = type;
      if (type === "user_id" && doc.userIdColumn) {
        val = doc.userIdColumn;
      } else if (type === "anonymous_id" && doc.anonymousIdColumn) {
        val = doc.anonymousIdColumn;
      }
      newDoc.userIdColumns = newDoc.userIdColumns || {};
      newDoc.userIdColumns[type] = val;
    });
  }

  return newDoc;
}

export function getDefaultExperimentQuery(
  settings: DataSourceSettings,
  userIdType = "user_id",
  schema?: string
): string {
  let column = userIdType;

  if (userIdType === "user_id") {
    column =
      settings?.experiments?.userIdColumn ||
      settings?.default?.userIdColumn ||
      "user_id";
  } else if (userIdType === "anonymous_id") {
    column =
      settings?.experiments?.anonymousIdColumn ||
      settings?.default?.anonymousIdColumn ||
      "anonymous_id";
  }

  return `SELECT
  ${column} as ${userIdType},
  ${
    settings?.experiments?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${
    settings?.experiments?.experimentIdColumn || "experiment_id"
  } as experiment_id,
  ${settings?.experiments?.variationColumn || "variation_id"} as variation_id
FROM 
  ${schema && !settings?.experiments?.table?.match(/\./) ? schema + "." : ""}${
    settings?.experiments?.table || "experiment_viewed"
  }`;
}

export function upgradeDatasourceObject(
  datasource: DataSourceInterface
): DataSourceInterface {
  const settings = datasource.settings;

  // Add default randomization units
  if (settings && !settings?.userIdTypes) {
    settings.userIdTypes = [
      { userIdType: "user_id", description: "Logged-in user id" },
      { userIdType: "anonymous_id", description: "Anonymous visitor id" },
    ];
  }

  // Upgrade old docs to the new exposure queries format
  if (settings && !settings?.queries?.exposure) {
    const integration = getSourceIntegrationObject(datasource);
    if (integration instanceof SqlIntegration) {
      settings.queries = settings.queries || {};
      settings.queries.exposure = [
        {
          id: "user_id",
          name: "Logged-in User Experiments",
          description: "",
          userIdType: "user_id",
          dimensions: settings.experimentDimensions || [],
          query:
            settings.queries.experimentsQuery ||
            getDefaultExperimentQuery(
              settings,
              "user_id",
              integration.getSchema()
            ),
        },
        {
          id: "anonymous_id",
          name: "Anonymous Visitor Experiments",
          description: "",
          userIdType: "anonymous_id",
          dimensions: settings.experimentDimensions || [],
          query:
            settings.queries.experimentsQuery ||
            getDefaultExperimentQuery(
              settings,
              "anonymous_id",
              integration.getSchema()
            ),
        },
      ];
    }
  }

  return datasource;
}

function updateEnvironmentSettings(
  rules: FeatureRule[],
  environments: string[],
  environment: string,
  feature: FeatureInterface
) {
  const settings: Partial<FeatureEnvironment> =
    feature.environmentSettings?.[environment] || {};

  if (!("rules" in settings)) {
    settings.rules = rules;
  }
  if (!("enabled" in settings)) {
    settings.enabled = environments?.includes(environment) || false;
  }

  // If Rules is an object instead of array, fix it
  if (settings.rules && !Array.isArray(settings.rules)) {
    settings.rules = Object.values(settings.rules);
  }

  feature.environmentSettings = feature.environmentSettings || {};
  feature.environmentSettings[environment] = settings as FeatureEnvironment;
}

function draftHasChanges(feature: FeatureInterface) {
  if (!feature.draft?.active) return false;

  if (
    "defaultValue" in feature.draft &&
    feature.draft.defaultValue !== feature.defaultValue
  ) {
    return true;
  }

  if (feature.draft.rules) {
    const comp: Record<string, FeatureRule[]> = {};
    Object.keys(feature.draft.rules).forEach((key) => {
      comp[key] = feature.environmentSettings?.[key]?.rules || [];
    });

    if (!isEqual(comp, feature.draft.rules)) {
      return true;
    }
  }

  return false;
}

export function upgradeFeatureRule(rule: FeatureRule): FeatureRule {
  // Old style experiment rule without coverage
  if (rule.type === "experiment" && !("coverage" in rule)) {
    rule.coverage = 1;
    const weights = rule.values
      .map((v) => v.weight)
      .map((w) => (w < 0 ? 0 : w > 1 ? 1 : w))
      .map((w) => roundVariationWeight(w));
    const totalWeight = getTotalVariationWeight(weights);
    if (totalWeight <= 0) {
      rule.coverage = 0;
    } else if (totalWeight < 0.999) {
      rule.coverage = totalWeight;
    }

    const multiplier = totalWeight > 0 ? 1 / totalWeight : 0;
    const adjustedWeights = adjustWeights(
      weights.map((w) => roundVariationWeight(w * multiplier))
    );

    rule.values = rule.values.map((v, j) => {
      return { ...v, weight: adjustedWeights[j] };
    });
  }

  return rule;
}

export function upgradeFeatureInterface(
  feature: LegacyFeatureInterface
): FeatureInterface {
  const { environments, rules, ...newFeature } = feature;

  // Copy over old way of storing rules/toggles to new environment-scoped settings
  updateEnvironmentSettings(rules || [], environments || [], "dev", newFeature);
  updateEnvironmentSettings(
    rules || [],
    environments || [],
    "production",
    newFeature
  );

  // Upgrade all published rules
  for (const env in newFeature.environmentSettings) {
    const settings = newFeature.environmentSettings[env];
    if (settings?.rules) {
      settings.rules = settings.rules.map((r) => upgradeFeatureRule(r));
    }
  }
  // Upgrade all draft rules
  if (newFeature.draft?.rules) {
    for (const env in newFeature.draft.rules) {
      const rules = newFeature.draft.rules;
      rules[env] = rules[env].map((r) => upgradeFeatureRule(r));
    }
  }

  // Ignore drafts if nothing has changed
  if (newFeature.draft?.active && !draftHasChanges(newFeature)) {
    newFeature.draft = { active: false };
  }

  return newFeature;
}

export function upgradeOrganizationDoc(
  doc: OrganizationInterface
): OrganizationInterface {
  const org = cloneDeep(doc);

  // Add dev/prod environments if there are none yet
  org.settings = org.settings || {};
  if (!org.settings?.environments?.length) {
    org.settings.environments = [
      {
        id: "dev",
        description: "",
        toggleOnList: true,
      },
      {
        id: "production",
        description: "",
        toggleOnList: true,
      },
    ];
  }

  // Change old `implementationTypes` field to new `visualEditorEnabled` field
  if (org.settings.implementationTypes) {
    if (!("visualEditorEnabled" in org.settings)) {
      org.settings.visualEditorEnabled = org.settings.implementationTypes.includes(
        "visual"
      );
    }
    delete org.settings.implementationTypes;
  }

  // Add a default role if one doesn't exist
  if (!org.settings.defaultRole) {
    org.settings.defaultRole = {
      role: "collaborator",
      environments: [],
      limitAccessByEnvironment: false,
    };
  }

  // Add settings from config.json
  const configSettings = getConfigOrganizationSettings();
  org.settings = Object.assign({}, org.settings || {}, configSettings);

  // Default attribute schema
  if (!org.settings.attributeSchema) {
    org.settings.attributeSchema = [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "deviceId", datatype: "string", hashAttribute: true },
      { property: "company", datatype: "string", hashAttribute: true },
      { property: "loggedIn", datatype: "boolean" },
      { property: "employee", datatype: "boolean" },
      { property: "country", datatype: "string" },
      { property: "browser", datatype: "string" },
      { property: "url", datatype: "string" },
    ];
  }

  // Rename legacy roles
  const legacyRoleMap: Record<string, MemberRole> = {
    designer: "collaborator",
    developer: "experimenter",
  };
  org.members.forEach((m) => {
    if (m.role in legacyRoleMap) {
      m.role = legacyRoleMap[m.role];
    }
  });

  return org;
}
