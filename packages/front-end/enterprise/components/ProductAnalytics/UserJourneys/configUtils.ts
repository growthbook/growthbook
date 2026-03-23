import { isEqual } from "lodash";
import type { UserJourneyConfig } from "shared/validators";
import { isCompleteFilter } from "@/enterprise/components/ProductAnalytics/util";

export function cleanUserJourneyConfigForSubmission(
  config: UserJourneyConfig,
): UserJourneyConfig {
  return {
    ...config,
    startingEventFilters: config.startingEventFilters.filter(isCompleteFilter),
    globalFilters: config.globalFilters.filter(isCompleteFilter),
  };
}

export function isConfigSubmittable(config: UserJourneyConfig): boolean {
  if (!config.datasource || !config.factTableId || !config.userIdType) {
    return false;
  }

  if (
    config.dateRange.predefined === "customDateRange" &&
    (!config.dateRange.startDate || !config.dateRange.endDate)
  ) {
    return false;
  }

  if (config.startingEventMode === "eventColumn") {
    return !!(
      config.startingEventEventColumn?.column &&
      config.startingEventEventColumn.value
    );
  }

  return config.startingEventFilters.some(isCompleteFilter);
}

export function compareUserJourneyConfig(
  lastSubmittedConfig: UserJourneyConfig | null,
  newConfig: UserJourneyConfig,
): { needsFetch: boolean; needsUpdate: boolean } {
  if (!lastSubmittedConfig) {
    const hasRequiredFields = isConfigSubmittable(newConfig);
    return { needsFetch: hasRequiredFields, needsUpdate: hasRequiredFields };
  }

  if (isEqual(lastSubmittedConfig, newConfig)) {
    return { needsFetch: false, needsUpdate: false };
  }

  return { needsFetch: true, needsUpdate: true };
}
