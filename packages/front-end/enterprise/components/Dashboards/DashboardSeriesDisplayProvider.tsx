import React, { ReactNode, useCallback, useContext, useMemo } from "react";
import { DisplaySettings } from "shared/enterprise";
import { CHART_COLOR_PALETTE } from "@/services/dataVizConfigUtilities";

export const DashboardSeriesDisplayContext = React.createContext<{
  settings: Record<string, DisplaySettings>;
  updateSeriesColor: (seriesKey: string, color: string) => void;
  updateSeriesDisplayName: (seriesKey: string, displayName: string) => void;
  updateSeriesHidden: (seriesKey: string, hidden: boolean) => void;
  getSeriesColor: (seriesKey: string, index: number) => string;
  getSeriesDisplayName: (seriesKey: string) => string | undefined;
  getSeriesHidden: (seriesKey: string) => boolean | undefined;
}>({
  settings: {},
  updateSeriesColor: () => {},
  updateSeriesDisplayName: () => {},
  updateSeriesHidden: () => {},
  getSeriesColor: () => "",
  getSeriesDisplayName: () => undefined,
  getSeriesHidden: () => undefined,
});

export default function DashboardSeriesDisplayProvider({
  seriesDisplaySettings,
  setSeriesDisplaySettings,
  children,
}: {
  seriesDisplaySettings?: Record<string, DisplaySettings>;
  setSeriesDisplaySettings?: (
    updater: (
      prev: Record<string, DisplaySettings>,
    ) => Record<string, DisplaySettings>,
  ) => void;
  children: ReactNode;
}) {
  // Ensure settings is always an object (handle undefined for existing dashboards)
  const settings = useMemo(
    () => seriesDisplaySettings ?? {},
    [seriesDisplaySettings],
  );

  const updateSeriesColor = (_seriesKey: string, _color: string) => {
    // TODO: Implement
  };

  const updateSeriesDisplayName = (
    _seriesKey: string,
    _displayName: string,
  ) => {
    // TODO: Implement
  };

  const updateSeriesHidden = (_seriesKey: string, _hidden: boolean) => {
    // TODO: Implement
  };

  const getSeriesColor = useCallback(
    (seriesKey: string, index: number): string => {
      // Check if seriesKey already has a color in dashboard settings
      const existingSettings = settings[seriesKey];
      if (existingSettings?.color) {
        return existingSettings.color;
      }

      // Select a new color using round-robin (index % palette length)
      const colorIndex = index % CHART_COLOR_PALETTE.length;
      const selectedColor = CHART_COLOR_PALETTE[colorIndex];

      // Update seriesDisplaySettings state directly (if setter is available)
      if (setSeriesDisplaySettings) {
        setSeriesDisplaySettings((prev) => {
          const next = { ...(prev ?? {}) };
          next[seriesKey] = {
            ...existingSettings, // Preserve any existing displayName or hidden settings
            color: selectedColor, // Override with new color
          };
          return next;
        });
      }

      return selectedColor;
    },
    [settings, setSeriesDisplaySettings],
  );

  const getSeriesDisplayName = (_seriesKey: string): string | undefined => {
    // TODO: Implement
    return undefined;
  };

  const getSeriesHidden = (_seriesKey: string): boolean | undefined => {
    // TODO: Implement
    return undefined;
  };

  const value = useMemo(
    () => ({
      settings,
      updateSeriesColor,
      updateSeriesDisplayName,
      updateSeriesHidden,
      getSeriesColor,
      getSeriesDisplayName,
      getSeriesHidden,
    }),
    [settings, getSeriesColor],
  );

  return (
    <DashboardSeriesDisplayContext.Provider value={value}>
      {children}
    </DashboardSeriesDisplayContext.Provider>
  );
}

export function useSeriesDisplaySettings() {
  const context = useContext(DashboardSeriesDisplayContext);
  if (!context) {
    throw new Error(
      "useSeriesDisplaySettings must be used within DashboardSeriesDisplayProvider",
    );
  }
  return context;
}
