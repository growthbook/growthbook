import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { DashboardInterface, DisplaySettings } from "shared/enterprise";
import { CHART_COLOR_PALETTE } from "@/services/dataVizConfigUtilities";

export const DashboardSeriesDisplayContext = React.createContext<{
  settings: Record<string, DisplaySettings>;
  updateSeriesColor: (seriesKey: string, color: string) => void;
  getSeriesColor: (seriesKey: string, index: number) => string;
}>({
  settings: {},
  updateSeriesColor: () => {},
  getSeriesColor: () => "",
});

export default function DashboardSeriesDisplayProvider({
  dashboard,
  setDashboard,
  children,
}: {
  dashboard: DashboardInterface | undefined;
  setDashboard: (
    updater: (
      prev: DashboardInterface | undefined,
    ) => DashboardInterface | undefined,
  ) => void;
  children: ReactNode;
}) {
  // Ensure settings is always an object (handle undefined for existing dashboards)
  const settings = useMemo(
    () => dashboard?.seriesDisplaySettings ?? {},
    [dashboard?.seriesDisplaySettings],
  );

  // Track color assignments during render to avoid race conditions
  // Updates are applied in useEffect after render to avoid warnings
  const pendingUpdatesRef = useRef<
    Map<string, { color: string; existingSettings?: DisplaySettings }>
  >(new Map());

  // Apply pending color updates after render
  useEffect(() => {
    if (pendingUpdatesRef.current.size === 0 || !dashboard) {
      return;
    }

    const updates = new Map(pendingUpdatesRef.current);
    pendingUpdatesRef.current.clear();

    setDashboard((prevDashboard) => {
      if (!prevDashboard) return prevDashboard;

      const currentSettings = prevDashboard.seriesDisplaySettings ?? {};
      const next = { ...currentSettings };
      let hasChanges = false;

      updates.forEach(({ color, existingSettings }, seriesKey) => {
        // Only update if color doesn't already exist (atomic check)
        if (!next[seriesKey]?.color) {
          next[seriesKey] = {
            ...(existingSettings ?? {}),
            color,
          };
          hasChanges = true;
        }
      });

      if (!hasChanges) return prevDashboard;

      return {
        ...prevDashboard,
        seriesDisplaySettings: next,
      };
    });
  }, [dashboard, setDashboard]);

  const updateSeriesColor = (_seriesKey: string, _color: string) => {
    // TODO: Implement
  };

  const getSeriesColor = useCallback(
    (seriesKey: string, index: number): string => {
      // Check if seriesKey already has a color in dashboard settings
      const existingSettings = settings[seriesKey];
      if (existingSettings?.color) {
        return existingSettings.color;
      }

      // Check if we've already assigned a color during this render cycle
      const pendingUpdate = pendingUpdatesRef.current.get(seriesKey);
      if (pendingUpdate?.color) {
        return pendingUpdate.color;
      }

      // Select a new color using round-robin (index % palette length)
      const colorIndex = index % CHART_COLOR_PALETTE.length;
      const selectedColor = CHART_COLOR_PALETTE[colorIndex];

      // Track this assignment to apply after render (prevents race conditions)
      pendingUpdatesRef.current.set(seriesKey, {
        color: selectedColor,
        existingSettings,
      });

      return selectedColor;
    },
    [settings],
  );

  const value = useMemo(
    () => ({
      settings,
      updateSeriesColor,
      getSeriesColor,
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
