import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentUnitsQuerySettings } from "shared/types/integrations";
import { ContextualBanditSnapshotSettings } from "../validators/contextual-bandit-snapshot";

export function buildUnitsQuerySettingsFromSnapshot(
  settings: ExperimentSnapshotSettings,
  exposureQuery: { query: string; userIdType: string },
): ExperimentUnitsQuerySettings {
  return {
    experimentId: settings.experimentId,
    exposureQuery,
    startDate: settings.startDate,
    endDate: settings.endDate,
    skipPartialData: settings.skipPartialData,
    attributionModel: settings.attributionModel,
    queryFilter: settings.queryFilter,
    phase: settings.phase,
    customFields: settings.customFields,
    variations: settings.variations,
    banditSettings: settings.banditSettings,
    metricSettings: settings.metricSettings,
  };
}

export function buildUnitsQuerySettingsFromCb(
  cbSettings: ContextualBanditSnapshotSettings,
): ExperimentUnitsQuerySettings {
  const decisionMetric = cbSettings.decisionMetric;
  return {
    experimentId: cbSettings.trackingKey,
    exposureQuery: {
      query: cbSettings.query,
      userIdType: cbSettings.userIdType,
    },
    startDate: cbSettings.startDate,
    endDate: cbSettings.endDate ?? new Date(),
    skipPartialData: false,
    attributionModel: "firstExposure",
    queryFilter: "",
    variations: cbSettings.variations,
    metricSettings: [],
    banditSettings: {
      contextualBandit: true,
      targetingAttributeColumns: cbSettings.contextualAttributes,
      reweight: cbSettings.reweight,
      decisionMetric,
      seed: cbSettings.banditWeightsSeed,
      currentWeights: cbSettings.variations.map((v) => v.weight),
      historicalWeights: [],
    },
  };
}
