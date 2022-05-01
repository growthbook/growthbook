import { DEFAULT_CONVERSION_WINDOW_HOURS } from "./secrets";
import { MetricInterface } from "../../types/metric";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "../../types/datasource";
import SqlIntegration from "../integrations/SqlIntegration";
import { getSourceIntegrationObject } from "../services/datasource";
import {
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";

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
  feature.environmentSettings = feature.environmentSettings || {};
  feature.environmentSettings[environment] =
    feature.environmentSettings[environment] || {};

  const settings = feature.environmentSettings[environment];

  if (!("rules" in settings)) {
    feature.environmentSettings[environment].rules = rules;
  }
  if (!("enabled" in settings)) {
    feature.environmentSettings[environment].enabled =
      environments?.includes(environment) || false;
  }

  // If Rules is an object instead of array, fix it
  if (!Array.isArray(settings.rules)) {
    settings.rules = Object.values(settings.rules);
  }
}

export function upgradeFeatureInterface(
  feature: LegacyFeatureInterface
): FeatureInterface {
  const { environments, rules, ...newFeature } = feature;

  updateEnvironmentSettings(rules || [], environments || [], "dev", newFeature);
  updateEnvironmentSettings(
    rules || [],
    environments || [],
    "production",
    newFeature
  );

  return newFeature;
}
