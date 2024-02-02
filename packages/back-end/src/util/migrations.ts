import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { LegacyMetricInterface, MetricInterface } from "../../types/metric";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "../../types/datasource";
import SqlIntegration from "../integrations/SqlIntegration";
import { getSourceIntegrationObject } from "../services/datasource";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
import { MemberRole, OrganizationInterface } from "../../types/organization";
import { getConfigOrganizationSettings } from "../init/config";
import {
  ExperimentInterface,
  LegacyExperimentInterface,
} from "../../types/experiment";
import {
  LegacyExperimentSnapshotInterface,
  ExperimentSnapshotInterface,
  MetricForSnapshot,
} from "../../types/experiment-snapshot";
import { getEnvironments } from "../services/organizations";
import {
  LegacySavedGroupInterface,
  SavedGroupInterface,
} from "../../types/saved-group";
import {
  FactMetricInterface,
  LegacyFactMetricInterface,
} from "../../types/fact-table";
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

export function upgradeFactMetricDoc(
  doc: LegacyFactMetricInterface
): FactMetricInterface {
  const newDoc: FactMetricInterface = { ...doc };

  if (doc.windowSettings === undefined) {
    newDoc.windowSettings = {
      type: doc.hasConversionWindow ? "conversion" : "",
      windowValue: doc.conversionWindowValue || DEFAULT_CONVERSION_WINDOW_HOURS,
      windowUnit: doc.conversionWindowUnit || "hours",
      delayHours: doc.conversionDelayHours || 0,
    };
  }

  if (doc.cappingSettings === undefined) {
    newDoc.cappingSettings = {
      type: doc.capping || "",
      value: doc.capValue || 0,
    };
  }

  return newDoc;
}

export function upgradeMetricDoc(doc: LegacyMetricInterface): MetricInterface {
  const newDoc = cloneDeep(doc);

  if (doc.windowSettings === undefined) {
    if (doc.conversionDelayHours == null && doc.earlyStart) {
      newDoc.windowSettings = {
        type: "conversion",
        windowValue:
          (doc.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) + 0.5,
        windowUnit: "hours",
        delayHours: -0.5,
      };
    } else {
      newDoc.windowSettings = {
        type: "conversion",
        windowValue:
          doc.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: "hours",
        delayHours: doc.conversionDelayHours || 0,
      };
    }
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

  if (doc.cappingSettings === undefined) {
    if (doc.capping === undefined && doc.cap) {
      newDoc.cappingSettings = {
        type: "absolute",
        value: doc.cap,
      };
    } else {
      newDoc.cappingSettings = {
        type: doc.capping || "",
        value: doc.capValue || 0,
      };
    }
  }

  // delete old fields
  delete newDoc.cap;
  delete newDoc.capping;
  delete newDoc.capValue;
  delete newDoc.conversionDelayHours;
  delete newDoc.conversionWindowHours;

  return newDoc as MetricInterface;
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

function draftHasChanges(
  feature: FeatureInterface,
  draft: FeatureDraftChanges
) {
  if (!draft?.active) return false;

  if ("defaultValue" in draft && draft.defaultValue !== feature.defaultValue) {
    return true;
  }

  if (draft.rules) {
    const comp: Record<string, FeatureRule[]> = {};
    Object.keys(draft.rules).forEach((key) => {
      comp[key] = feature.environmentSettings?.[key]?.rules || [];
    });

    if (!isEqual(comp, draft.rules)) {
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
  const { environments, rules, revision, draft, ...newFeature } = feature;

  // Copy over old way of storing rules/toggles to new environment-scoped settings
  updateEnvironmentSettings(rules || [], environments || [], "dev", newFeature);
  updateEnvironmentSettings(
    rules || [],
    environments || [],
    "production",
    newFeature
  );

  newFeature.version = feature.version || revision?.version || 1;

  // Upgrade all published rules
  for (const env in newFeature.environmentSettings) {
    const settings = newFeature.environmentSettings[env];
    if (settings?.rules) {
      settings.rules = settings.rules.map((r) => upgradeFeatureRule(r));
    }
  }

  if (draft) {
    // Upgrade all draft rules
    if (draft?.rules) {
      for (const env in draft.rules) {
        const rules = draft.rules;
        rules[env] = rules[env].map((r) => upgradeFeatureRule(r));
      }
    }
    // Ignore drafts if nothing has changed
    if (draft?.active && !draftHasChanges(newFeature, draft)) {
      draft.active = false;
    }

    if (draft.active) {
      const revisionRules: Record<string, FeatureRule[]> = {};
      Object.entries(newFeature.environmentSettings).forEach(
        ([env, { rules }]) => {
          revisionRules[env] = rules;

          if (draft.rules && draft.rules[env]) {
            revisionRules[env] = draft.rules[env];
          }
        }
      );

      newFeature.legacyDraft = {
        baseVersion: newFeature.version,
        comment: draft.comment || "",
        createdBy: null,
        dateCreated: draft.dateCreated || feature.dateCreated,
        datePublished: null,
        dateUpdated: draft.dateUpdated || feature.dateUpdated,
        defaultValue: draft.defaultValue ?? newFeature.defaultValue,
        featureId: newFeature.id,
        organization: newFeature.organization,
        publishedBy: null,
        status: "draft",
        version: newFeature.version + 1,
        rules: revisionRules,
      };
    }
  }

  if (newFeature.legacyDraft && !newFeature.legacyDraftMigrated) {
    newFeature.hasDrafts = true;
  }

  return newFeature;
}

export function upgradeOrganizationDoc(
  doc: OrganizationInterface
): OrganizationInterface {
  const org = cloneDeep(doc);

  // Add settings from config.json
  const configSettings = getConfigOrganizationSettings();
  org.settings = Object.assign({}, org.settings || {}, configSettings);

  // Add default environments if there are none yet
  org.settings.environments = getEnvironments(org);

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

  // Add statsEngine setting if not defined
  if (!org.settings.statsEngine) {
    org.settings.statsEngine = DEFAULT_STATS_ENGINE;
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

export function upgradeExperimentDoc(
  orig: LegacyExperimentInterface
): ExperimentInterface {
  const experiment = cloneDeep(orig);

  // Add missing variation keys and ids
  experiment.variations.forEach((v, i) => {
    if (v.key === "" || v.key === undefined || v.key === null) {
      v.key = i + "";
    }
    if (!v.id) {
      v.id = i + "";
    }
    if (!v.name) {
      v.name = i ? `Variation ${i}` : `Control`;
    }
  });

  // Populate phase names and targeting properties
  if (experiment.phases) {
    experiment.phases.forEach((phase) => {
      if (!phase.name) {
        const p = phase.phase || "main";
        phase.name = p.substring(0, 1).toUpperCase() + p.substring(1);
      }

      phase.coverage = phase.coverage ?? 1;
      phase.condition = phase.condition || "";
      phase.seed = phase.seed || experiment.trackingKey;
      phase.namespace = phase.namespace || {
        enabled: false,
        name: "",
        range: [0, 1],
      };
      // Some experiments have a namespace with only `enabled` set, no idea why
      // This breaks namespaces, so add default values if missing
      if (!phase.namespace.range) {
        phase.namespace = {
          enabled: false,
          name: "",
          range: [0, 1],
        };
      }
    });
  }

  // Upgrade the attribution model
  if (experiment.attributionModel === "allExposures") {
    experiment.attributionModel = "experimentDuration";
  }

  // Add hashAttribute field
  experiment.hashAttribute = experiment.hashAttribute || "";

  // Add hashVersion field
  experiment.hashVersion = experiment.hashVersion || 2;

  // Old `observations` field
  if (!experiment.description && experiment.observations) {
    experiment.description = experiment.observations;
  }

  // metric overrides
  if (experiment.metricOverrides) {
    experiment.metricOverrides.forEach((mo) => {
      mo.delayHours = mo.delayHours || mo.conversionDelayHours;
      mo.windowHours = mo.windowHours || mo.conversionWindowHours;
      if (
        mo.windowType === undefined &&
        mo.conversionWindowHours !== undefined
      ) {
        mo.windowType = "conversion";
      }
    });
  }

  // releasedVariationId
  if (!("releasedVariationId" in experiment)) {
    if (experiment.status === "stopped") {
      if (experiment.results === "lost") {
        experiment.releasedVariationId = experiment.variations[0]?.id || "";
      } else if (experiment.results === "won") {
        experiment.releasedVariationId =
          experiment.variations[experiment.winner || 1]?.id || "";
      } else {
        experiment.releasedVariationId = "";
      }
    } else {
      experiment.releasedVariationId = "";
    }
  }

  if (!("sequentialTestingEnabled" in experiment)) {
    experiment.sequentialTestingEnabled = false;
  }
  if (!("sequentialTestingTuningParameter" in experiment)) {
    experiment.sequentialTestingTuningParameter = DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  }

  return experiment as ExperimentInterface;
}

export function migrateSnapshot(
  orig: LegacyExperimentSnapshotInterface
): ExperimentSnapshotInterface {
  const {
    activationMetric,
    statsEngine,
    // eslint-disable-next-line
    hasRawQueries,
    // eslint-disable-next-line
    hasCorrectedStats,
    // eslint-disable-next-line
    query,
    // eslint-disable-next-line
    queryLanguage,
    results,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    sequentialTestingEnabled,
    sequentialTestingTuningParameter,
    queryFilter,
    segment,
    skipPartialData,
    manual,
    ...snapshot
  } = orig;

  // Convert old results to new array of analyses
  if (!snapshot.analyses) {
    if (results) {
      const regressionAdjusted =
        regressionAdjustmentEnabled &&
        metricRegressionAdjustmentStatuses?.some(
          (s) => s.regressionAdjustmentEnabled
        )
          ? true
          : false;

      snapshot.analyses = [
        {
          dateCreated: snapshot.dateCreated,
          status: snapshot.error ? "error" : "success",
          settings: {
            statsEngine: statsEngine || DEFAULT_STATS_ENGINE,
            dimensions: snapshot.dimension ? [snapshot.dimension] : [],
            pValueCorrection: null,
            regressionAdjusted,
            sequentialTesting: !!sequentialTestingEnabled,
            differenceType: "relative",
            sequentialTestingTuningParameter:
              sequentialTestingTuningParameter ||
              DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
          },
          results,
        },
      ];
      if (snapshot.error) {
        snapshot.analyses[0].error = snapshot.error;
      }
    } else {
      snapshot.analyses = [];
    }
  }

  // Figure out status from old fields
  if (!snapshot.status) {
    snapshot.status = snapshot.error
      ? "error"
      : snapshot.analyses.length > 0
      ? "success"
      : "running";
  }

  // Migrate settings
  // We weren't tracking all of these before, so just pick good defaults
  if (!snapshot.settings) {
    // Try to figure out metric ids from results
    const metricIds = Object.keys(results?.[0]?.variations?.[0]?.metrics || {});
    if (activationMetric && !metricIds.includes(activationMetric)) {
      metricIds.push(activationMetric);
    }

    const variations = (results?.[0]?.variations || []).map((v, i) => ({
      id: i + "",
      weight: 0,
    }));

    const metricSettings: MetricForSnapshot[] = metricIds.map((id) => {
      const regressionSettings = metricRegressionAdjustmentStatuses?.find(
        (s) => s.metric === id
      );

      return {
        id,
        computedSettings: {
          windowSettings: {
            type: "conversion",
            delayHours: 0,
            windowUnit: "hours",
            windowValue: DEFAULT_CONVERSION_WINDOW_HOURS,
          },
          regressionAdjustmentDays:
            regressionSettings?.regressionAdjustmentDays || 0,
          regressionAdjustmentEnabled: !!(
            regressionAdjustmentEnabled &&
            regressionSettings?.regressionAdjustmentEnabled
          ),
          regressionAdjustmentAvailable: !!regressionSettings?.regressionAdjustmentAvailable,
          regressionAdjustmentReason: regressionSettings?.reason || "",
        },
      };
    });

    snapshot.settings = {
      manual: !!manual,
      dimensions: snapshot.dimension
        ? [
            {
              id: snapshot.dimension,
            },
          ]
        : [],
      metricSettings,
      // We know the metric ids included, but don't know if they were goals or guardrails
      // Just add them all as goals (doesn't really change much)
      goalMetrics: metricIds.filter((m) => m !== activationMetric),
      guardrailMetrics: [],
      activationMetric: activationMetric || null,
      regressionAdjustmentEnabled: !!regressionAdjustmentEnabled,
      startDate: snapshot.dateCreated,
      endDate: snapshot.dateCreated,
      experimentId: "",
      datasourceId: "",
      exposureQueryId: "",
      queryFilter: queryFilter || "",
      segment: segment || "",
      skipPartialData: !!skipPartialData,
      attributionModel: "firstExposure",
      variations,
    };
  }

  // Some fields used to be optional, but are now required
  if (!snapshot.queries) {
    snapshot.queries = [];
  }
  if (!snapshot.multipleExposures) {
    snapshot.multipleExposures = 0;
  }
  if (!snapshot.unknownVariations) {
    snapshot.unknownVariations = [];
  }
  if (!snapshot.dimension) {
    snapshot.dimension = "";
  }
  if (!snapshot.runStarted) {
    snapshot.runStarted = null;
  }

  return snapshot;
}

export function migrateSavedGroup(
  legacy: LegacySavedGroupInterface
): SavedGroupInterface {
  // Add `type` field to legacy groups
  const { source, type, ...otherFields } = legacy;
  const group: SavedGroupInterface = {
    ...otherFields,
    type: type || (source === "runtime" ? "condition" : "list"),
  };

  // Migrate legacy runtime groups to use a condition
  if (
    group.type === "condition" &&
    !group.condition &&
    source === "runtime" &&
    group.attributeKey
  ) {
    group.condition = JSON.stringify({
      $groups: {
        $elemMatch: {
          $eq: group.attributeKey,
        },
      },
    });
  }

  return group;
}
