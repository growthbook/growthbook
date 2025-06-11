import { DashboardSettingsInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import React, { createContext, useContext } from "react";

interface DashboardSettingsContext {
  baselineRow: number;
  dateStart: Date;
  dateEnd: Date;
  defaultMetricId: string;
  defaultVariationIds: string[];
  defaultDimensionId: string;
  defaultDimensionValues: string[];
  setBaselineRow: React.Dispatch<number>;
  setDateStart: React.Dispatch<Date>;
  setDateEnd: React.Dispatch<Date>;
  setDefaultMetricId: React.Dispatch<string>;
  setDefaultVariationIds: React.Dispatch<string[]>;
  setDefaultDimensionId: React.Dispatch<string>;
  setDefaultDimensionValues: React.Dispatch<string[]>;
}

const dashboardSettingsContext = createContext<DashboardSettingsContext | null>(
  null
);

export default function DashboardSettingsProvider({
  children,
  settings,
  setSettings,
}: {
  children: React.ReactNode;
  settings: DashboardSettingsInterface;
  setSettings: (s: DashboardSettingsInterface) => void;
}) {
  const setBaselineRow = (r: number) =>
    setSettings({ ...settings, baselineRow: r });
  const setDateStart = (d: Date) => setSettings({ ...settings, dateStart: d });
  const setDateEnd = (d: Date) => setSettings({ ...settings, dateEnd: d });
  const setDefaultMetricId = (mid: string) =>
    setSettings({ ...settings, defaultMetricId: mid });
  const setDefaultVariationIds = (vids: string[]) =>
    setSettings({ ...settings, defaultVariationIds: vids });
  const setDefaultDimensionId = (did: string) =>
    setSettings({ ...settings, defaultDimensionId: did });
  const setDefaultDimensionValues = (dvals: string[]) =>
    setSettings({ ...settings, defaultDimensionValues: dvals });

  return (
    <dashboardSettingsContext.Provider
      value={{
        ...settings,
        setBaselineRow,
        setDateStart,
        setDateEnd,
        setDefaultMetricId,
        setDefaultVariationIds,
        setDefaultDimensionId,
        setDefaultDimensionValues,
      }}
    >
      {children}
    </dashboardSettingsContext.Provider>
  );
}

export function useDashboardSettings() {
  const context = useContext(dashboardSettingsContext);

  if (!context)
    throw new Error(
      "useDashboardSettings must be called from within the DashboardSettingsProvider"
    );

  return context;
}
