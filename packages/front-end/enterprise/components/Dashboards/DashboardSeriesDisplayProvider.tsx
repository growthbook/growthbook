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
  getActiveSeriesKeys: () => Map<string, Set<string>>;
}>({
  settings: {},
  updateSeriesColor: () => {},
  getSeriesColor: () => "",
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
  // Track color assignments during render to avoid race conditions
  // Updates are applied in useEffect after render to avoid warnings
  // Key format: `${columnName}:${dimensionValue}`
  const pendingUpdatesRef = useRef<
    Map<
      string,
      {
        color: string;
        existingSettings?: DisplaySettings;
        columnName: string;
        dimensionValue: string;
      }
    >
  >(new Map());

  // Track debounce timers per series key to avoid spamming API calls
  // Key format: `${columnName}:${dimensionValue}`
  const saveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Track active series keys (keys that are currently being used in charts)
  // This is populated during render via getSeriesColor() calls
  // Structure: Map<columnName, Set<dimensionValue>>
  const activeSeriesKeysRef = useRef<Map<string, Set<string>>>(new Map());

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

  // Track settings state separately to handle updates from both prop and local state
  const [settingsState, setSettingsState] = React.useState<
    Record<string, Record<string, DisplaySettings>>
  >(() => dashboard?.seriesDisplaySettings ?? {});

  // Sync settings state from dashboard prop when it changes
  // Merge with pending auto-assigned colors to preserve them during sync
  useEffect(() => {
    if (dashboard?.seriesDisplaySettings !== undefined) {
      const merged = { ...dashboard.seriesDisplaySettings };
      // Preserve auto-assigned colors that haven't been persisted yet
      pendingUpdatesRef.current.forEach(
        ({ color, existingSettings, columnName, dimensionValue }) => {
          if (!merged[columnName]) {
            merged[columnName] = {};
          }
          if (!merged[columnName][dimensionValue]?.color) {
            merged[columnName][dimensionValue] = {
              ...(existingSettings ?? {}),
              color,
            };
          }
        },
      );
      setSettingsState(merged);
    } else if (dashboard) {
      // Dashboard exists but has no seriesDisplaySettings (legacy dashboard)
      const merged: Record<string, Record<string, DisplaySettings>> = {};
      pendingUpdatesRef.current.forEach(
        ({ color, existingSettings, columnName, dimensionValue }) => {
          if (!merged[columnName]) {
            merged[columnName] = {};
          }
          merged[columnName][dimensionValue] = {
            ...(existingSettings ?? {}),
            color,
          };
        },
      );
      setSettingsState(merged);
    }
  }, [dashboard?.seriesDisplaySettings, dashboard]);

  // Merge settingsState with pending updates so settings reflects both persisted and in-flight changes
  // Compute directly (not memoized) so it always includes current pendingUpdatesRef state
  const settings = (() => {
    const merged: Record<string, Record<string, DisplaySettings>> = {};
    // Deep clone the settings state
    Object.keys(settingsState).forEach((columnName) => {
      merged[columnName] = { ...settingsState[columnName] };
    });
    // Include pending updates so settings is immediately available during render
    pendingUpdatesRef.current.forEach(
      ({ color, existingSettings, columnName, dimensionValue }) => {
        if (!merged[columnName]) {
          merged[columnName] = {};
        }
        if (!merged[columnName][dimensionValue]?.color) {
          merged[columnName][dimensionValue] = {
            ...(existingSettings ?? {}),
            color,
          };
        }
      },
    );
    return merged;
  })();

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
      const next: Record<string, Record<string, DisplaySettings>> = {};
      // Deep clone current settings
      Object.keys(currentSettings).forEach((columnName) => {
        next[columnName] = { ...currentSettings[columnName] };
      });
      let hasChanges = false;

      updates.forEach(
        ({ color, existingSettings, columnName, dimensionValue }) => {
          if (!next[columnName]) {
            next[columnName] = {};
          }
          // Only update if color doesn't already exist (atomic check)
          if (!next[columnName][dimensionValue]?.color) {
            next[columnName][dimensionValue] = {
              ...(existingSettings ?? {}),
              color,
            };
            hasChanges = true;
          }
        },
      );

      if (!hasChanges) return prevDashboard;

      // Clean settings to remove any entries without colors before saving
      const cleanedSettings = cleanSeriesDisplaySettings(next);

      const updatedDashboard = {
        ...prevDashboard,
        seriesDisplaySettings: cleanedSettings,
      };

      // Update local settings state immediately (use cleaned version)
      setSettingsState(cleanedSettings ?? {});

      return updatedDashboard;
    });
  }, [dashboard, setDashboard, cleanSeriesDisplaySettings]);

  const updateSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, color: string) => {
      setDashboard((prevDashboard) => {
        if (!prevDashboard) return prevDashboard;
        const currentSettings = prevDashboard.seriesDisplaySettings ?? {};
        const next: Record<string, Record<string, DisplaySettings>> = {};
        // Deep clone current settings
        Object.keys(currentSettings).forEach((colName) => {
          next[colName] = { ...currentSettings[colName] };
        });
        if (!next[columnName]) {
          next[columnName] = {};
        }
        next[columnName][dimensionValue] = {
          ...(next[columnName][dimensionValue] ?? {}),
          color,
        };

        // Clean settings to remove any entries without colors
        const cleanedSettings = cleanSeriesDisplaySettings(next);

        // Update local settings state for UI feedback
        setSettingsState(cleanedSettings ?? {});

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

  const getSeriesColor = useCallback(
    (columnName: string, dimensionValue: string, index: number): string => {
      // Track active series keys
      if (!activeSeriesKeysRef.current.has(columnName)) {
        activeSeriesKeysRef.current.set(columnName, new Set());
      }
      activeSeriesKeysRef.current.get(columnName)!.add(dimensionValue);

      // Check if this series already has a color in dashboard settings
      const existingSettings = settings[columnName]?.[dimensionValue];
      if (existingSettings?.color) {
        return existingSettings.color;
      }

      // Check if we've already assigned a color during this render cycle
      const seriesKey = `${columnName}:${dimensionValue}`;
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
        columnName,
        dimensionValue,
      });

      return selectedColor;
    },
    [settings],
  );

  // Get the map of active series keys grouped by column name (for filtering)
  const getActiveSeriesKeys = useCallback(() => {
    const result = new Map<string, Set<string>>();
    activeSeriesKeysRef.current.forEach((dimensionValues, columnName) => {
      result.set(columnName, new Set(dimensionValues));
    });
    return result;
  }, []);

  // Cleanup debounce timers and pending updates on unmount
  useEffect(() => {
    const timers = saveTimersRef.current;
    const pendingUpdates = pendingUpdatesRef.current;
    return () => {
      // Clear all debounce timers
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      timers.clear();
      // Clear pending updates to prevent memory leaks
      pendingUpdates.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSeriesColor,
      getSeriesColor,
      getActiveSeriesKeys,
    }),
    [settings, updateSeriesColor, getSeriesColor, getActiveSeriesKeys],
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
