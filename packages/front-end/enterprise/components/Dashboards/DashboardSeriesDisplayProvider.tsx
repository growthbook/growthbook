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
  const pendingUpdatesRef = useRef<
    Map<string, { color: string; existingSettings?: DisplaySettings }>
  >(new Map());

  // Track debounce timers per seriesKey to avoid spamming API calls
  const saveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Store latest dashboard ref to avoid stale closures in debounce callbacks
  const latestDashboardRef = useRef<DashboardInterface | undefined>(dashboard);
  useEffect(() => {
    latestDashboardRef.current = dashboard;
  }, [dashboard]);

  // Track settings state separately to handle updates from both prop and local state
  const [settingsState, setSettingsState] = React.useState<
    Record<string, DisplaySettings>
  >(() => dashboard?.seriesDisplaySettings ?? {});

  // Always sync settings state from dashboard prop when it changes
  // This ensures we stay in sync after saves, while pending updates merge naturally
  useEffect(() => {
    if (dashboard?.seriesDisplaySettings !== undefined) {
      // Merge with any pending updates to avoid losing in-flight changes
      const merged = { ...dashboard.seriesDisplaySettings };
      pendingUpdatesRef.current.forEach(
        ({ color, existingSettings }, seriesKey) => {
          if (!merged[seriesKey]?.color) {
            merged[seriesKey] = {
              ...(existingSettings ?? {}),
              color,
            };
          }
        },
      );
      setSettingsState(merged);
    } else if (dashboard) {
      // Dashboard exists but has no seriesDisplaySettings (legacy dashboard)
      // Merge with pending updates
      const merged: Record<string, DisplaySettings> = {};
      pendingUpdatesRef.current.forEach(
        ({ color, existingSettings }, seriesKey) => {
          merged[seriesKey] = {
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
    const merged = { ...settingsState };
    // Include pending updates so settings is immediately available during render
    pendingUpdatesRef.current.forEach(
      ({ color, existingSettings }, seriesKey) => {
        if (!merged[seriesKey]?.color) {
          merged[seriesKey] = {
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

      const updatedDashboard = {
        ...prevDashboard,
        seriesDisplaySettings: next,
      };

      // Update local settings state immediately
      setSettingsState(next);

      return updatedDashboard;
    });
  }, [dashboard, setDashboard]);

  const updateSeriesColor = useCallback(
    (seriesKey: string, color: string) => {
      console.log("updateSeriesColor", seriesKey, color);
      setDashboard((prevDashboard) => {
        if (!prevDashboard) return prevDashboard;
        const currentSettings = prevDashboard.seriesDisplaySettings ?? {};
        const next = { ...currentSettings };
        next[seriesKey] = {
          ...(next[seriesKey] ?? {}),
          color,
        };

        // Update local settings state immediately for instant UI feedback
        setSettingsState(next);

        const updatedDashboard = {
          ...prevDashboard,
          seriesDisplaySettings: next,
        };

        // Debounce the save operation to avoid spamming API calls
        if (onSave && updatedDashboard.id && updatedDashboard.id !== "new") {
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
              onSave(currentDashboard).catch((e) => {
                console.error("Failed to save series display settings:", e);
              });
            }
          }, 750); // 750ms debounce delay

          saveTimersRef.current.set(seriesKey, timer);
        }

        return updatedDashboard;
      });
    },
    [setDashboard, onSave],
  );

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
    }),
    [settings, updateSeriesColor, getSeriesColor],
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
