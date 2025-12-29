import React, {
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DashboardInterface, DisplaySettings } from "shared/enterprise";
import { CHART_COLOR_PALETTE } from "@/services/dataVizConfigUtilities";

export const DashboardSeriesDisplayContext = React.createContext<{
  settings: Map<string, DisplaySettings>;
  updateSeriesColor: (seriesKey: string, color: string) => void;
  updateSeriesDisplayName: (seriesKey: string, displayName: string) => void;
  updateSeriesHidden: (seriesKey: string, hidden: boolean) => void;
  getSeriesColor: (seriesKey: string, index: number) => string;
  getSeriesDisplayName: (seriesKey: string) => string | undefined;
  getSeriesHidden: (seriesKey: string) => boolean | undefined;
}>({
  settings: new Map(),
  updateSeriesColor: () => {},
  updateSeriesDisplayName: () => {},
  updateSeriesHidden: () => {},
  getSeriesColor: () => "",
  getSeriesDisplayName: () => undefined,
  getSeriesHidden: () => undefined,
});

export default function DashboardSeriesDisplayProvider({
  dashboard,
  children,
}: {
  dashboard?: DashboardInterface;
  children: ReactNode;
}) {
  // Initialize settings from dashboard
  const [localSettings, setLocalSettings] = useState<
    Map<string, DisplaySettings>
  >(() => dashboard?.seriesDisplaySettings ?? new Map());

  console.log("localSettings", localSettings);

  // Update local settings when dashboard changes
  useEffect(() => {
    if (dashboard?.seriesDisplaySettings) {
      setLocalSettings(dashboard.seriesDisplaySettings);
    }
  }, [dashboard?.seriesDisplaySettings]);

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

  const getSeriesColor = (seriesKey: string, index: number): string => {
    // TOOD: Build this out - currently just returning the color based on the index.
    return CHART_COLOR_PALETTE[index];
  };

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
      settings: localSettings,
      updateSeriesColor,
      updateSeriesDisplayName,
      updateSeriesHidden,
      getSeriesColor,
      getSeriesDisplayName,
      getSeriesHidden,
    }),
    [localSettings],
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
