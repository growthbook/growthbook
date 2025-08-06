import { ApiSettings } from "back-end/types/openapi";

export function toSettingsApiInterface(query): ApiSettings {
  return {
    confidenceLevel: query.confidenceLevel,
    northStar: query.northStar,
    metricDefaults: query.metricDefaults,
    pastExperimentsMinLength: query.pastExperimentsMinLength,
    metricAnalysisDays: query.metricAnalysisDays || null,
    updateSchedule: query.updateSchedule || null,
    sdkInstructionsViewed: query.sdkInstructionsViewed,
    videoInstructionsViewed: query.videoInstructionsViewed,
    multipleExposureMinPercent: query.multipleExposureMinPercent,
    defaultRole: query.defaultRole,
    statsEngine: query.statsEngine,
    pValueThreshold: query.pValueThreshold,
    regressionAdjustmentEnabled: query.regressionAdjustmentEnabled,
    regressionAdjustmentDays: query.regressionAdjustmentDays,
    sequentialTestingEnabled: query.sequentialTestingEnabled,
    sequentialTestingTuningParameter: query.sequentialTestingTuningParameter,
    attributionModel: query.attributionModel,
    secureAttributeSalt: query.secureAttributeSalt,
    killswitchConfirmation: query.killswitchConfirmation,
    requireReviews: query.requireReviews,
    featureKeyExample: query.featureKeyExample,
    featureRegexValidator: query.featureRegexValidator,
    banditScheduleValue: query.banditScheduleValue,
    banditScheduleUnit: query.banditScheduleUnit,
    banditBurnInValue: query.banditBurnInValue,
    banditBurnInUnit: query.banditBurnInUnit,
    experimentMinLengthDays: query.experimentMinLengthDays,
    experimentMaxLengthDays: query.experimentMaxLengthDays
      ? query.experimentMaxLengthDays
      : null,
  };
}
