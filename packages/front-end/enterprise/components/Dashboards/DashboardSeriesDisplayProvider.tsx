import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { SeriesDisplaySettings } from "shared/enterprise";
import { CHART_COLOR_PALETTE } from "@/services/dataVizConfigUtilities";

// Delimiter used to create composite keys for series (columnName + dimensionValue)
// Using ||| to avoid conflicts with colons that may appear in dimension values
export const SERIES_KEY_DELIMITER = "|||";

export const DashboardSeriesDisplayContext = React.createContext<{
  settings: SeriesDisplaySettings;
  getSeriesDisplaySettings: () => SeriesDisplaySettings | undefined;
  updateSeriesColor: (
    columnName: string,
    dimensionValue: string,
    color: string,
  ) => void;
  getSeriesColor: (
    columnName: string,
    dimensionValue: string,
    index: number,
  ) => string;
  registerSeriesKeys: (
    keys: Array<{ columnName: string; dimensionValue: string }>,
  ) => void;
  getActiveSeriesKeys: () => Map<string, Set<string>>;
}>({
  settings: {},
  getSeriesDisplaySettings: () => undefined,
  updateSeriesColor: () => {},
  getSeriesColor: () => "",
  registerSeriesKeys: () => {},
  getActiveSeriesKeys: () => new Map(),
});

export default function DashboardSeriesDisplayProvider({
  dashboard,
  onSave,
  children,
}: {
  dashboard:
    | {
        id?: string;
        seriesDisplaySettings?: SeriesDisplaySettings;
      }
    | undefined;
  onSave?: (
    seriesDisplaySettings: SeriesDisplaySettings,
  ) => Promise<void> | void;
  children: ReactNode;
}) {
  // Manage seriesDisplaySettings state internally
  const [seriesDisplaySettings, setSeriesDisplaySettings] = React.useState<
    SeriesDisplaySettings | undefined
  >(dashboard?.seriesDisplaySettings);

  // Sync state when dashboard prop changes
  useEffect(() => {
    setSeriesDisplaySettings(dashboard?.seriesDisplaySettings);
  }, [dashboard?.seriesDisplaySettings]);

  // Track active series keys (keys that are currently being used in charts)
  const activeSeriesKeys = new Map<string, Set<string>>();

  // Single debounce timer for all saves (both computed and manual)
  const saveTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  // Refs to avoid stale closures in debounced callbacks
  const onSaveRef = useRef(onSave);
  const dashboardIdRef = useRef(dashboard?.id);

  // Update refs when props change
  useEffect(() => {
    onSaveRef.current = onSave;
    dashboardIdRef.current = dashboard?.id;
  }, [onSave, dashboard?.id]);

  const settings = useMemo(
    () => seriesDisplaySettings ?? {},
    [seriesDisplaySettings],
  );

  // Debounced save function - shared for both computed and manual color updates
  const debouncedSave = useCallback(() => {
    if (
      !onSaveRef.current ||
      !dashboardIdRef.current ||
      dashboardIdRef.current === "new"
    ) {
      return;
    }

    // Clear any existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Set a new timer to save after changes stop
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      // Read current state when timer fires (avoid stale closures)
      setSeriesDisplaySettings((currentSettings) => {
        const currentDashboardId = dashboardIdRef.current;
        if (
          currentSettings &&
          currentDashboardId &&
          currentDashboardId !== "new" &&
          onSaveRef.current
        ) {
          Promise.resolve(onSaveRef.current(currentSettings)).catch((e) => {
            console.error("Failed to save series display settings:", e);
          });
        }
        return currentSettings; // Don't modify state, just read it
      });
    }, 750); // 750ms debounce delay
  }, []);

  // Save when seriesDisplaySettings changes (debounced)
  useEffect(() => {
    // Only save if we have settings and dashboard exists
    if (seriesDisplaySettings && dashboard?.id && dashboard.id !== "new") {
      debouncedSave();
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
    };
  }, [seriesDisplaySettings, debouncedSave, dashboard?.id]);

  const updateSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, color: string) => {
      setSeriesDisplaySettings((prevSettings) => {
        const currentSettings = prevSettings ?? {};
        // Only update if color is actually different
        if (currentSettings[columnName]?.[dimensionValue]?.color === color) {
          return prevSettings;
        }

        return {
          ...currentSettings,
          [columnName]: {
            ...currentSettings[columnName],
            [dimensionValue]: {
              ...(currentSettings[columnName]?.[dimensionValue] ?? {}),
              color,
            },
          },
        };
      });
    },
    [setSeriesDisplaySettings],
  );

  // Register series keys for tracking (called explicitly by components during render)
  // Not memoized because activeSeriesKeys is recreated each render intentionally
  // This allows us to clean up series keys that are no longer being used by the dashboard
  const registerSeriesKeys = (
    keys: Array<{ columnName: string; dimensionValue: string }>,
  ) => {
    keys.forEach(({ columnName, dimensionValue }) => {
      if (!activeSeriesKeys.has(columnName)) {
        activeSeriesKeys.set(columnName, new Set());
      }
      activeSeriesKeys.get(columnName)!.add(dimensionValue);
    });
  };

  const getSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, index: number): string => {
      // Check if this series already has a color in dashboard settings
      const existingColor = settings[columnName]?.[dimensionValue]?.color;
      if (existingColor) {
        return existingColor;
      }

      // Select a new color using round-robin (index % palette length)
      const colorIndex = index % CHART_COLOR_PALETTE.length;
      const selectedColor = CHART_COLOR_PALETTE[colorIndex];

      // Update state directly - React will batch these updates
      setSeriesDisplaySettings((prevSettings) => {
        const currentSettings = prevSettings ?? {};
        // Only add if color doesn't already exist
        if (currentSettings[columnName]?.[dimensionValue]?.color) {
          return prevSettings;
        }

        return {
          ...currentSettings,
          [columnName]: {
            ...currentSettings[columnName],
            [dimensionValue]: { color: selectedColor },
          },
        };
      });

      return selectedColor;
    },
    [settings, setSeriesDisplaySettings],
  );

  // Get the map of active series keys grouped by column name (for filtering)
  const getActiveSeriesKeys = () => {
    const result = new Map<string, Set<string>>();
    activeSeriesKeys.forEach((dimensionValues, columnName) => {
      result.set(columnName, new Set(dimensionValues));
    });
    return result;
  };

  // Get current seriesDisplaySettings (for use in save operations)
  const getSeriesDisplaySettings = useCallback(() => {
    return seriesDisplaySettings;
  }, [seriesDisplaySettings]);

  // Don't memoize value since getActiveSeriesKeys needs to be recreated each render
  // to capture the current activeSeriesKeys
  const value = {
    settings,
    getSeriesDisplaySettings,
    updateSeriesColor,
    getSeriesColor,
    registerSeriesKeys,
    getActiveSeriesKeys,
  };

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
