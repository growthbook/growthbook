import { DisplaySettings } from "shared/enterprise";

// Helper function that filters the seriesDisplaySettings to only include entries that have a color property & are actively being used in the dashboard
// This ensures we're only storing colors for series that are actually being used in the dashboard
export function filterSeriesDisplaySettings(
  settings: Record<string, Record<string, DisplaySettings>> | undefined,
  activeKeys?: Map<string, Set<string>>,
): Record<string, Record<string, DisplaySettings>> | undefined {
  if (!settings || Object.keys(settings).length === 0) {
    return undefined;
  }

  const filtered: Record<string, Record<string, DisplaySettings>> = {};

  Object.entries(settings).forEach(([columnName, dimensionSettings]) => {
    // If activeKeys provided, only process columns that have active series
    if (activeKeys) {
      const activeDimensions = activeKeys.get(columnName);
      if (!activeDimensions || activeDimensions.size === 0) {
        return; // Skip this column - no active series
      }

      const filteredDimensions: Record<string, DisplaySettings> = {};
      Object.entries(dimensionSettings).forEach(
        ([dimensionValue, displaySettings]) => {
          if (activeDimensions.has(dimensionValue) && displaySettings?.color) {
            filteredDimensions[dimensionValue] = displaySettings;
          }
        },
      );

      if (Object.keys(filteredDimensions).length > 0) {
        filtered[columnName] = filteredDimensions;
      }
    } else {
      // No activeKeys filter - just clean to remove entries without colors
      const cleanedDimensions: Record<string, DisplaySettings> = {};
      Object.entries(dimensionSettings).forEach(
        ([dimensionValue, displaySettings]) => {
          if (displaySettings?.color) {
            cleanedDimensions[dimensionValue] = displaySettings;
          }
        },
      );

      if (Object.keys(cleanedDimensions).length > 0) {
        filtered[columnName] = cleanedDimensions;
      }
    }
  });

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
