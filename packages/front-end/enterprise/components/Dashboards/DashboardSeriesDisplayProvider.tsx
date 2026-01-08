import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { DashboardInterface, DisplaySettings } from "shared/enterprise";
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
  updateSeriesColor: () => {},
  getSeriesColor: () => "",
  registerSeriesKeys: () => {},
  getActiveSeriesKeys: () => new Map(),
});

export default function DashboardSeriesDisplayProvider({
  dashboard,
  setDashboard,
  onSave,
  children,
}: {
  dashboard: DashboardInterface | undefined;
  setDashboard: (
    updater: (
      prev: DashboardInterface | undefined,
    ) => DashboardInterface | undefined,
  ) => void;
  onSave?: (dashboard: DashboardInterface) => Promise<void> | void;
  children: ReactNode;
}) {
  // Track computed colors that haven't been persisted yet
  // Key format: `${columnName}:${dimensionValue}` -> color string
  const computedColorsRef = useRef<Map<string, string>>(new Map());

  // Track debounce timers per series key to avoid spamming API calls
  const saveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Track active series keys (keys that are currently being used in charts)
  const activeSeriesKeys = new Map<string, Set<string>>();

  // Store latest dashboard ref to avoid stale closures in debounce callbacks
  const latestDashboardRef = useRef<DashboardInterface | undefined>(dashboard);
  useEffect(() => {
    latestDashboardRef.current = dashboard;
  }, [dashboard]);

  // Clean up seriesDisplaySettings by removing entries without required color field
  const cleanSeriesDisplaySettings = useCallback(
    (
      settings: Record<string, Record<string, DisplaySettings>> | undefined,
    ): Record<string, Record<string, DisplaySettings>> | undefined => {
      if (!settings) return undefined;

      const cleaned: Record<string, Record<string, DisplaySettings>> = {};
      Object.entries(settings).forEach(([columnName, dimensionSettings]) => {
        const cleanedDimensions: Record<string, DisplaySettings> = {};
        Object.entries(dimensionSettings).forEach(
          ([dimensionValue, displaySettings]) => {
            // Only include entries that have a color (required field)
            if (displaySettings?.color) {
              cleanedDimensions[dimensionValue] = displaySettings;
            }
          },
        );
        // Only include columns that have at least one valid dimension
        if (Object.keys(cleanedDimensions).length > 0) {
          cleaned[columnName] = cleanedDimensions;
        }
      });

      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    },
    [],
  );

  // Derive settings from dashboard prop + computed colors (single source of truth)
  // Compute on every render (not memoized) so it always includes latest computedColorsRef
  const settings = (() => {
    const base = dashboard?.seriesDisplaySettings ?? {};
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

  // Persist computed colors after render
  useEffect(() => {
    if (computedColorsRef.current.size === 0 || !dashboard) {
      return;
    }

    const colorsToPersist = new Map(computedColorsRef.current);
    computedColorsRef.current.clear();

    setDashboard((prevDashboard) => {
      if (!prevDashboard) return prevDashboard;

      const currentSettings = prevDashboard.seriesDisplaySettings ?? {};
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

      if (!hasChanges) return prevDashboard;

      return {
        ...prevDashboard,
        seriesDisplaySettings: cleanSeriesDisplaySettings(updated),
      };
    });
  }, [dashboard, setDashboard, cleanSeriesDisplaySettings]);

  const updateSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, color: string) => {
      setDashboard((prevDashboard) => {
        if (!prevDashboard) return prevDashboard;

        const currentSettings = prevDashboard.seriesDisplaySettings ?? {};
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

        const cleanedSettings = cleanSeriesDisplaySettings(updated);

        const updatedDashboard = {
          ...prevDashboard,
          seriesDisplaySettings: cleanedSettings,
        };

        // Debounce the save operation to avoid spamming API calls
        if (onSave && updatedDashboard.id && updatedDashboard.id !== "new") {
          const seriesKey = `${columnName}:${dimensionValue}`;
          // Clear any existing timer for this seriesKey
          const existingTimer = saveTimersRef.current.get(seriesKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          // Set a new timer to save after user stops changing the color
          // Read from latestDashboardRef to avoid stale closure issues
          const timer = setTimeout(() => {
            saveTimersRef.current.delete(seriesKey);
            const currentDashboard = latestDashboardRef.current;
            if (currentDashboard?.id && currentDashboard.id !== "new") {
              // Clean settings before saving to remove any entries without colors
              const cleanedDashboard = {
                ...currentDashboard,
                seriesDisplaySettings: cleanSeriesDisplaySettings(
                  currentDashboard.seriesDisplaySettings,
                ),
              };
              Promise.resolve(onSave(cleanedDashboard)).catch((e) => {
                console.error("Failed to save series display settings:", e);
              });
            }
          }, 750); // 750ms debounce delay

          saveTimersRef.current.set(seriesKey, timer);
        }

        return updatedDashboard;
      });
    },
    [setDashboard, onSave, cleanSeriesDisplaySettings],
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
    return () => {
      // Clear all debounce timers
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
      // Clear computed colors to prevent memory leaks
      computedColors.clear();
    };
  }, []);

  // Don't memoize value since getActiveSeriesKeys needs to be recreated each render
  // to capture the current activeSeriesKeys
  const value = {
    settings,
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
