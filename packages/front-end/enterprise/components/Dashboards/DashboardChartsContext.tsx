import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from "react";
import * as echarts from "echarts/core";

interface DashboardChartsContextValue {
  registerChart: (id: string, instance: echarts.ECharts) => void;
  unregisterChart: (id: string) => void;
}

const DashboardChartsContext =
  createContext<DashboardChartsContextValue | null>(null);

export function useDashboardCharts() {
  const context = useContext(DashboardChartsContext);
  if (!context) {
    return null;
  }
  return context;
}

interface DashboardChartsProviderProps {
  children: React.ReactNode;
}

export function DashboardChartsProvider({
  children,
}: DashboardChartsProviderProps) {
  const chartsRef = useRef<Map<string, echarts.ECharts>>(new Map());
  const connectedGroupIdRef = useRef<string | null>(null);
  const GROUP_ID = "dashboard-charts-group";

  const connectCharts = useCallback(() => {
    // Disconnect previous group if it exists
    if (connectedGroupIdRef.current) {
      try {
        echarts.disconnect(connectedGroupIdRef.current);
      } catch (error) {
        // Ignore errors if charts are already disconnected or disposed
        console.debug("Error disconnecting charts:", error);
      }
      connectedGroupIdRef.current = null;
    }

    // Get all current chart instances
    const instances = Array.from(chartsRef.current.values());

    // Only connect if we have 2+ charts
    if (instances.length >= 2) {
      try {
        // Set group ID on all charts
        instances.forEach((instance) => {
          instance.group = GROUP_ID;
        });
        // Connect charts with the group ID
        echarts.connect(GROUP_ID);
        connectedGroupIdRef.current = GROUP_ID;
      } catch (error) {
        console.error("Error connecting charts:", error);
      }
    }
  }, []);

  const registerChart = useCallback(
    (id: string, instance: echarts.ECharts) => {
      chartsRef.current.set(id, instance);
      // Use setTimeout to ensure all charts are registered before connecting
      // This handles cases where multiple charts mount simultaneously
      setTimeout(() => {
        connectCharts();
      }, 0);
    },
    [connectCharts],
  );

  const unregisterChart = useCallback(
    (id: string) => {
      chartsRef.current.delete(id);
      // Reconnect remaining charts
      setTimeout(() => {
        connectCharts();
      }, 0);
    },
    [connectCharts],
  );

  // Cleanup on unmount
  useEffect(() => {
    const groupId = connectedGroupIdRef.current;

    return () => {
      if (groupId) {
        try {
          echarts.disconnect(groupId);
        } catch (error) {
          // Ignore cleanup errors
          console.debug("Error disconnecting charts on unmount:", error);
        }
      }
    };
  }, []);

  return (
    <DashboardChartsContext.Provider
      value={{
        registerChart,
        unregisterChart,
      }}
    >
      {children}
    </DashboardChartsContext.Provider>
  );
}
