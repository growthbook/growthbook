import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { RESERVED_ROLE_IDS, getDefaultRole } from "shared/permissions";
import { omit } from "lodash";
import { SavedGroupInterface } from "shared/src/types";
import { v4 as uuidv4 } from "uuid";
import { accountFeatures } from "shared/enterprise";
import {
  ExperimentReportArgs,
  ExperimentReportInterface,
  LegacyReportInterface,
} from "back-end/types/report";
import { WebhookInterface } from "back-end/types/webhook";
import { SdkWebHookLogDocument } from "back-end/src/models/SdkWebhookLogModel";
import { LegacyMetricInterface, MetricInterface } from "back-end/types/metric";
import {
  DataSourceInterface,
  DataSourceSettings,
} from "back-end/types/datasource";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "back-end/types/feature";
import { OrganizationInterface } from "back-end/types/organization";
import { getConfigOrganizationSettings } from "back-end/src/init/config";
import {
  ExperimentInterface,
  LegacyExperimentInterface,
} from "back-end/types/experiment";
import {
  LegacyExperimentSnapshotInterface,
  ExperimentSnapshotInterface,
  MetricForSnapshot,
} from "back-end/types/experiment-snapshot";
import { getEnvironments } from "back-end/src/services/organizations";
import { LegacySavedGroupInterface } from "back-end/types/saved-group";
import { getAccountPlan } from "back-end/src/enterprise";
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

export function upgradeMetricDoc(doc: LegacyMetricInterface): MetricInterface {
  const newDoc = { ...doc };

  if (doc.windowSettings === undefined) {
    if (doc.conversionDelayHours == null && doc.earlyStart) {
      newDoc.windowSettings = {
        type: "conversion",
        windowValue:
          (doc.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) + 0.5,
        windowUnit: "hours",
        delayUnit: "hours",
        delayValue: -0.5,
      };
    } else {
      newDoc.windowSettings = {
        type: "conversion",
        windowValue:
          doc.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: "hours",
        delayUnit: "hours",
        delayValue: doc.conversionDelayHours || 0,
      };
    }
  } else {
    if (doc.windowSettings.delayValue === undefined) {
      newDoc.windowSettings = {
        ...doc.windowSettings,
        delayValue: doc.windowSettings.delayHours ?? 0,
        delayUnit: doc.windowSettings.delayUnit ?? "hours",
      };
    }

    delete newDoc?.windowSettings?.delayHours;
  }

  if (doc.priorSettings === undefined) {
    newDoc.priorSettings = {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    };
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
  schema?: string,
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
  datasource: DataSourceInterface,
): DataSourceInterface {
  datasource.settings = datasource.settings || {};

  const settings = datasource.settings;

  // Add default randomization units
  if (settings && !settings?.userIdTypes) {
    settings.userIdTypes = [
      { userIdType: "user_id", description: "Logged-in user id" },
      { userIdType: "anonymous_id", description: "Anonymous visitor id" },
    ];
  }

  // Sanity check as somehow this ended up with null value in the array
  if (settings.userIdTypes) {
    settings.userIdTypes = settings.userIdTypes?.filter((it) => !!it);
  }

  // Upgrade old docs to the new exposure queries format
  if (settings && !settings?.queries?.exposure) {
    const isSQL = !["google_analytics", "mixpanel"].includes(datasource.type);
    if (isSQL) {
      let schema = "";
      try {
        const params = decryptDataSourceParams(datasource.params);
        if (
          "defaultSchema" in params &&
          typeof params.defaultSchema === "string"
        ) {
          schema = params.defaultSchema;
        }
      } catch (e) {
        // Ignore decryption errors, they are handled elsewhere
      }

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
            getDefaultExperimentQuery(settings, "user_id", schema),
        },
        {
          id: "anonymous_id",
          name: "Anonymous Visitor Experiments",
          description: "",
          userIdType: "anonymous_id",
          dimensions: settings.experimentDimensions || [],
          query:
            settings.queries.experimentsQuery ||
            getDefaultExperimentQuery(settings, "anonymous_id", schema),
        },
      ];
    }
  }

  // mode field was added later -- default to ephemeral if missing
  if (
    settings &&
    settings.pipelineSettings &&
    !settings.pipelineSettings.mode
  ) {
    settings.pipelineSettings.mode = "ephemeral";
  }

  return datasource;
}

function updateEnvironmentSettings(
  rules: FeatureRule[],
  environments: string[],
  environment: string,
  feature: FeatureInterface,
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
  draft: FeatureDraftChanges,
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
      weights.map((w) => roundVariationWeight(w * multiplier)),
    );

    rule.values = rule.values.map((v, j) => {
      return { ...v, weight: adjustedWeights[j] };
    });
  }

  return rule;
}

export function upgradeFeatureInterface(
  feature: LegacyFeatureInterface,
): FeatureInterface {
  const { environments, rules, revision, draft, ...newFeature } = feature;

  // Copy over old way of storing rules/toggles to new environment-scoped settings
  updateEnvironmentSettings(rules || [], environments || [], "dev", newFeature);
  updateEnvironmentSettings(
    rules || [],
    environments || [],
    "production",
    newFeature,
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
        },
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

  if (newFeature.jsonSchema) {
    newFeature.jsonSchema.schemaType =
      newFeature.jsonSchema.schemaType || "schema";
    newFeature.jsonSchema.simple = newFeature.jsonSchema.simple || {
      type: "object",
      fields: [],
    };
  }

  return newFeature;
}

export function upgradeOrganizationDoc(
  doc: OrganizationInterface,
): OrganizationInterface {
  const org = cloneDeep(doc);
  const commercialFeatures = [...accountFeatures[getAccountPlan(org)]];

  // Add settings from config.json
  const configSettings = getConfigOrganizationSettings();
  org.settings = Object.assign({}, org.settings || {}, configSettings);

  // Add default environments if there are none yet
  org.settings.environments = getEnvironments(org);

  // Change old `implementationTypes` field to new `visualEditorEnabled` field
  if (org.settings.implementationTypes) {
    if (!("visualEditorEnabled" in org.settings)) {
      org.settings.visualEditorEnabled =
        org.settings.implementationTypes.includes("visual");
    }
    delete org.settings.implementationTypes;
  }

  // Add a default role if one doesn't exist
  if (!org.settings.defaultRole) {
    org.settings.defaultRole = getDefaultRole(org);
  } else {
    // if the defaultRole is a custom role and the org no longer has that feature, default to collaborator
    if (
      !RESERVED_ROLE_IDS.includes(org.settings.defaultRole.role) &&
      !commercialFeatures.includes("custom-roles")
    ) {
      org.settings.defaultRole = {
        role: "collaborator",
        environments: [],
        limitAccessByEnvironment: false,
      };
    }
  }

  // Default attribute schema for backwards compatibility
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

  // Migrate Arroval Flow Settings
  if (
    org.settings?.requireReviews === true ||
    org.settings?.requireReviews === false
  ) {
    org.settings.requireReviews = [
      {
        requireReviewOn: org.settings.requireReviews,
        resetReviewOnChange: false,
        environments: [],
        projects: [],
      },
    ];
  }
  // Rename legacy roles
  const legacyRoleMap: Record<string, string> = {
    designer: "collaborator",
    developer: "experimenter",
  };
  org.members.forEach((m) => {
    if (m.role in legacyRoleMap) {
      m.role = legacyRoleMap[m.role];
    }
  });

  // Make sure namespaces have labels- if it's missing, use the name
  if (org?.settings?.namespaces?.length) {
    org.settings.namespaces = org.settings.namespaces.map((ns) => ({
      ...ns,
      label: ns.label || ns.name,
    }));
  }

  return org;
}

export function upgradeExperimentDoc(
  orig: LegacyExperimentInterface,
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

  // Convert metric fields to new names
  if (!experiment.goalMetrics) {
    experiment.goalMetrics = experiment.metrics || [];
  }
  if (!experiment.guardrailMetrics) {
    experiment.guardrailMetrics = experiment.guardrails || [];
  }
  if (!experiment.secondaryMetrics) {
    experiment.secondaryMetrics = [];
  }

  // Populate phase names and targeting properties
  if (experiment.phases) {
    experiment.phases.forEach((phase) => {
      if (!phase.name) {
        const p = phase.phase || "main";
        phase.name = p.substring(0, 1).toUpperCase() + p.substring(1);
      }

      phase.coverage = phase.coverage ?? 1;
      phase.condition = phase.condition || "";
      phase.seed = phase.seed || experiment.trackingKey; //support for old experiments where tracking key was used as seed instead of UUID
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

      // move bandit SRM to health.srm
      if (phase.banditEvents) {
        phase.banditEvents = phase.banditEvents.map((event) => ({
          ...event,
          ...(event.banditResult?.srm !== undefined &&
            event?.health?.srm === undefined && {
              health: {
                srm: event.banditResult.srm,
              },
            }),
        }));
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

  if (experiment.decisionFrameworkSettings === undefined) {
    experiment.decisionFrameworkSettings = {};
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
    experiment.sequentialTestingTuningParameter =
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  }

  if (!("shareLevel" in experiment)) {
    experiment.shareLevel = "organization";
  }
  if (!("uid" in experiment)) {
    experiment.uid = uuidv4().replace(/-/g, "");
  }

  return experiment as ExperimentInterface;
}

export function migrateExperimentReport(
  orig: LegacyReportInterface,
): ExperimentReportInterface {
  const { args, ...report } = orig;

  const {
    attributionModel,
    metricRegressionAdjustmentStatuses,
    metrics,
    guardrails,
    ...otherArgs
  } = args || {};

  const newArgs: ExperimentReportArgs = {
    secondaryMetrics: [],
    ...otherArgs,
    attributionModel:
      (attributionModel as string) === "allExposures"
        ? "experimentDuration"
        : attributionModel,
    goalMetrics: otherArgs.goalMetrics || metrics || [],
    guardrailMetrics: otherArgs.guardrailMetrics || guardrails || [],
    decisionFrameworkSettings: otherArgs.decisionFrameworkSettings || {},
  };

  if (
    metricRegressionAdjustmentStatuses &&
    newArgs.settingsForSnapshotMetrics === undefined
  ) {
    newArgs.settingsForSnapshotMetrics = metricRegressionAdjustmentStatuses.map(
      (m) => ({
        metric: m.metric,
        properPrior: false,
        properPriorMean: 0,
        properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
        regressionAdjustmentReason: m.reason,
        regressionAdjustmentDays: m.regressionAdjustmentDays,
        regressionAdjustmentEnabled: m.regressionAdjustmentEnabled,
        regressionAdjustmentAvailable: m.regressionAdjustmentAvailable,
      }),
    );
  }

  return {
    ...report,
    args: newArgs,
  };
}

export function migrateSnapshot(
  orig: LegacyExperimentSnapshotInterface,
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
  // Try to figure out metric ids from results
  const metricIds = Object.keys(results?.[0]?.variations?.[0]?.metrics || {});
  if (activationMetric && !metricIds.includes(activationMetric)) {
    metricIds.push(activationMetric);
  }

  // We know the metric ids included, but don't know if they were goals or guardrails
  // Just add them all as goals (doesn't really change much)
  const goalMetrics = metricIds.filter((m) => m !== activationMetric);

  // Convert old results to new array of analyses
  if (!snapshot.analyses) {
    if (results) {
      const regressionAdjusted =
        regressionAdjustmentEnabled &&
        metricRegressionAdjustmentStatuses?.some(
          (s) => s.regressionAdjustmentEnabled,
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
            numGoalMetrics: goalMetrics.length,
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

  const defaultMetricPriorSettings = {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };
  // Migrate settings
  // We weren't tracking all of these before, so just pick good defaults
  if (!snapshot.settings) {
    const variations = (results?.[0]?.variations || []).map((v, i) => ({
      id: i + "",
      weight: 0,
    }));

    const metricSettings: MetricForSnapshot[] = metricIds.map((id) => {
      const regressionSettings = metricRegressionAdjustmentStatuses?.find(
        (s) => s.metric === id,
      );

      return {
        id,
        computedSettings: {
          windowSettings: {
            type: "conversion",
            delayUnit: "hours",
            delayValue: 0,
            windowUnit: "hours",
            windowValue: DEFAULT_CONVERSION_WINDOW_HOURS,
          },
          properPrior: defaultMetricPriorSettings.proper,
          properPriorMean: defaultMetricPriorSettings.mean,
          properPriorStdDev: defaultMetricPriorSettings.stddev,
          regressionAdjustmentDays:
            regressionSettings?.regressionAdjustmentDays || 0,
          regressionAdjustmentEnabled: !!(
            regressionAdjustmentEnabled &&
            regressionSettings?.regressionAdjustmentEnabled
          ),
          regressionAdjustmentAvailable:
            !!regressionSettings?.regressionAdjustmentAvailable,
          regressionAdjustmentReason: regressionSettings?.reason || "",
          targetMDE: undefined,
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
      goalMetrics,
      secondaryMetrics: [],
      guardrailMetrics: [],
      activationMetric: activationMetric || null,
      defaultMetricPriorSettings: defaultMetricPriorSettings,
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
  } else {
    // Add new settings field in case it is missing
    if (snapshot.settings.defaultMetricPriorSettings === undefined) {
      snapshot.settings.defaultMetricPriorSettings = defaultMetricPriorSettings;
    }

    // This field could be undefined before, make it always an array
    if (!snapshot.settings.secondaryMetrics) {
      snapshot.settings.secondaryMetrics = [];
    }

    // migrate metric for snapshot to have new fields as old snapshots
    // may not have prior settings
    snapshot.settings.metricSettings = snapshot.settings.metricSettings.map(
      (m) => {
        if (m.computedSettings) {
          m.computedSettings = {
            ...defaultMetricPriorSettings,
            ...m.computedSettings,
          };
          if (m.computedSettings.windowSettings?.delayValue === undefined) {
            m.computedSettings.windowSettings = {
              ...m.computedSettings.windowSettings,
              // @ts-expect-error To prevent building a full legacy snapshot settings type
              delayValue: m.computedSettings.windowSettings?.delayHours ?? 0,
              delayUnit:
                m.computedSettings.windowSettings?.delayUnit ?? "hours",
            };
          }
        }
        return m;
      },
    );
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
  legacy: LegacySavedGroupInterface,
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

export function migrateSdkWebhookLogModel(
  doc: SdkWebHookLogDocument,
): SdkWebHookLogDocument {
  if (doc?.webhookReduestId) {
    doc.webhookRequestId = doc.webhookReduestId;
    delete doc.webhookReduestId;
  }
  return doc;
}

export function migrateWebhookModel(doc: WebhookInterface): WebhookInterface {
  const newDoc = omit(doc, ["sendPayload"]) as WebhookInterface;
  if (!doc.payloadFormat) {
    if (doc.httpMethod === "GET") {
      newDoc.payloadFormat = "none";
    } else if (doc.sendPayload) {
      newDoc.payloadFormat = "standard";
    } else {
      newDoc.payloadFormat = "standard-no-payload";
    }
  }
  return newDoc;
}
