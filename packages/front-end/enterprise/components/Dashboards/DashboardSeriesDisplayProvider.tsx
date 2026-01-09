import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { DisplaySettings } from "shared/enterprise";
import { CHART_COLOR_PALETTE } from "@/services/dataVizConfigUtilities";

// Helper function to deep clone settings
function deepCloneSettings(
  settings: Record<string, Record<string, DisplaySettings>>,
): Record<string, Record<string, DisplaySettings>> {
  const cloned: Record<string, Record<string, DisplaySettings>> = {};
  Object.keys(settings).forEach((columnName) => {
    cloned[columnName] = { ...settings[columnName] };
  });
  return cloned;
}

export const DashboardSeriesDisplayContext = React.createContext<{
  settings: Record<string, Record<string, DisplaySettings>>;
  getSeriesDisplaySettings: () =>
    | Record<string, Record<string, DisplaySettings>>
    | undefined;
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
        seriesDisplaySettings?: Record<string, Record<string, DisplaySettings>>;
      }
    | undefined;
  onSave?: (
    seriesDisplaySettings: Record<string, Record<string, DisplaySettings>>,
  ) => Promise<void> | void;
  children: ReactNode;
}) {
  // Manage seriesDisplaySettings state internally
  const [seriesDisplaySettings, setSeriesDisplaySettings] = React.useState<
    Record<string, Record<string, DisplaySettings>> | undefined
  >(dashboard?.seriesDisplaySettings);

  // Sync state when dashboard prop changes
  useEffect(() => {
    setSeriesDisplaySettings(dashboard?.seriesDisplaySettings);
  }, [dashboard?.seriesDisplaySettings]);
  // Track computed colors that haven't been persisted yet
  // Key format: `${columnName}:${dimensionValue}` -> color string
  const computedColorsRef = useRef<Map<string, string>>(new Map());

  // Track debounce timers per series key to avoid spamming API calls
  const saveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  // Track timer for computed colors save
  const computedColorsSaveTimerRef = useRef<NodeJS.Timeout | undefined>(
    undefined,
  );

  // Track active series keys (keys that are currently being used in charts)
  const activeSeriesKeys = new Map<string, Set<string>>();

  // Store latest settings ref for debounced save callbacks
  const latestSettingsRef = useRef<
    Record<string, Record<string, DisplaySettings>>
  >(seriesDisplaySettings ?? {});
  const dashboardIdRef = useRef<string | undefined>(dashboard?.id);
  useEffect(() => {
    latestSettingsRef.current = seriesDisplaySettings ?? {};
    dashboardIdRef.current = dashboard?.id;
  }, [seriesDisplaySettings, dashboard?.id]);

  // Derive settings from seriesDisplaySettings prop + computed colors (single source of truth)
  // Compute on every render (not memoized) so it always includes latest computedColorsRef
  const settings = (() => {
    const base = seriesDisplaySettings ?? {};
    const result = deepCloneSettings(base);

    // Add computed colors that haven't been persisted yet
    computedColorsRef.current.forEach((color, key) => {
      const [columnName, dimensionValue] = key.split(":");
      if (!result[columnName]) {
        result[columnName] = {};
      }
      // Only add if not already in base settings (don't override persisted colors)
      if (!result[columnName][dimensionValue]?.color) {
        result[columnName][dimensionValue] = { color };
      }
    });

    return result;
  })();

  // Persist computed colors after render and trigger save if needed
  useEffect(() => {
    if (computedColorsRef.current.size === 0) {
      return;
    }

    const colorsToPersist = new Map(computedColorsRef.current);
    computedColorsRef.current.clear();

    setSeriesDisplaySettings((prevSettings) => {
      const currentSettings = prevSettings ?? {};
      const updated = deepCloneSettings(currentSettings);
      let hasChanges = false;

      colorsToPersist.forEach((color, key) => {
        const [columnName, dimensionValue] = key.split(":");
        if (!updated[columnName]) {
          updated[columnName] = {};
        }
        // Only update if color doesn't already exist (atomic check)
        if (!updated[columnName][dimensionValue]?.color) {
          updated[columnName][dimensionValue] = { color };
          hasChanges = true;
        }
      });

      if (!hasChanges) return prevSettings;

      // Update latest settings ref for potential saves
      latestSettingsRef.current = updated;

      // If we added new colors and dashboard exists, trigger a debounced save
      if (hasChanges && onSave && dashboard?.id && dashboard.id !== "new") {
        // Clear any existing timer
        if (computedColorsSaveTimerRef.current) {
          clearTimeout(computedColorsSaveTimerRef.current);
        }

        // Debounce the save to avoid spamming when multiple colors are computed
        computedColorsSaveTimerRef.current = setTimeout(() => {
          computedColorsSaveTimerRef.current = undefined;
          const currentSettings = latestSettingsRef.current;
          const currentDashboardId = dashboardIdRef.current;
          if (currentDashboardId && currentDashboardId !== "new") {
            Promise.resolve(onSave(currentSettings)).catch((e) => {
              console.error("Failed to save computed colors:", e);
            });
          }
        }, 1000);
      }

      return updated;
    });
  }, [setSeriesDisplaySettings, onSave, dashboard?.id]);

  const updateSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, color: string) => {
      setSeriesDisplaySettings((prevSettings) => {
        const currentSettings = prevSettings ?? {};
        const updated = {
          ...currentSettings,
          [columnName]: {
            ...currentSettings[columnName],
            [dimensionValue]: {
              ...(currentSettings[columnName]?.[dimensionValue] ?? {}),
              color,
            },
          },
        };

        // Update the latest settings ref for debounced saves
        latestSettingsRef.current = updated;

        // Debounce the save operation to avoid spamming API calls
        if (onSave && dashboard?.id && dashboard.id !== "new") {
          const seriesKey = `${columnName}:${dimensionValue}`;
          // Clear any existing timer for this seriesKey
          const existingTimer = saveTimersRef.current.get(seriesKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          // Set a new timer to save after user stops changing the color
          // Use refs to read the latest values when the debounce fires (avoid stale closures)
          const timer = setTimeout(() => {
            saveTimersRef.current.delete(seriesKey);
            const currentSettings = latestSettingsRef.current;
            const currentDashboardId = dashboardIdRef.current;
            if (currentDashboardId && currentDashboardId !== "new") {
              Promise.resolve(onSave(currentSettings)).catch((e) => {
                console.error("Failed to save series display settings:", e);
              });
            }
          }, 750); // 750ms debounce delay

          saveTimersRef.current.set(seriesKey, timer);
        }

        return updated;
      });
    },
    [setSeriesDisplaySettings, onSave, dashboard?.id],
  );

  // Register series keys for tracking (called explicitly by components during render)
  // Not memoized because activeSeriesKeys is recreated each render anyway
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
      const seriesKey = `${columnName}:${dimensionValue}`;

      // Check if this series already has a color in dashboard settings
      const existingColor = settings[columnName]?.[dimensionValue]?.color;
      if (existingColor) {
        return existingColor;
      }

      // Check if we've already computed a color during this render cycle
      const computedColor = computedColorsRef.current.get(seriesKey);
      if (computedColor) {
        return computedColor;
      }

      // Select a new color using round-robin (index % palette length)
      const colorIndex = index % CHART_COLOR_PALETTE.length;
      const selectedColor = CHART_COLOR_PALETTE[colorIndex];

      // Track this assignment to persist after render
      computedColorsRef.current.set(seriesKey, selectedColor);

      return selectedColor;
    },
    [settings],
  );

  // Get the map of active series keys grouped by column name (for filtering)
  const getActiveSeriesKeys = () => {
    const result = new Map<string, Set<string>>();
    activeSeriesKeys.forEach((dimensionValues, columnName) => {
      result.set(columnName, new Set(dimensionValues));
    });
    return result;
  };

  // Cleanup debounce timers and computed colors on unmount
  useEffect(() => {
    const timers = saveTimersRef.current;
    const computedColors = computedColorsRef.current;
    const computedColorsTimer = computedColorsSaveTimerRef.current;
    return () => {
      // Clear all debounce timers
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
      // Clear computed colors save timer
      if (computedColorsTimer) {
        clearTimeout(computedColorsTimer);
      }
      // Clear computed colors to prevent memory leaks
      computedColors.clear();
    };
  }, []);

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
