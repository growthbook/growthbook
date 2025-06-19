import { DashboardSettingsInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { DifferenceType } from "back-end/types/stats";
import React, { createContext, useContext } from "react";

interface DashboardSettingsContext {
  defaultSnapshotSettings: {
    dimensionId: string;
  };
  defaultAnalysisSettings: {
    baselineVariationIndex: number;
    differenceType: DifferenceType;
  };
  dateStart: Date;
  dateEnd: Date;
  defaultMetricId: string;
  defaultVariationIds: string[];
  defaultDimensionValues: string[];
  setBaselineRow: React.Dispatch<number>;
  setDifferenceType: React.Dispatch<DifferenceType>;
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
    setSettings({
      ...settings,
      defaultAnalysisSettings: {
        ...settings.defaultAnalysisSettings,
        baselineVariationIndex: r,
      },
    });
  const setDifferenceType = (t: DifferenceType) =>
    setSettings({
      ...settings,
      defaultAnalysisSettings: {
        ...settings.defaultAnalysisSettings,
        differenceType: t,
      },
    });
  const setDateStart = (d: Date) => setSettings({ ...settings, dateStart: d });
  const setDateEnd = (d: Date) => setSettings({ ...settings, dateEnd: d });
  const setDefaultMetricId = (mid: string) =>
    setSettings({ ...settings, defaultMetricId: mid });
  const setDefaultVariationIds = (vids: string[]) =>
    setSettings({ ...settings, defaultVariationIds: vids });
  const setDefaultDimensionId = (did: string) =>
    setSettings({
      ...settings,
      defaultSnapshotSettings: {
        ...settings.defaultSnapshotSettings,
        dimensionId: did,
      },
    });
  const setDefaultDimensionValues = (dvals: string[]) =>
    setSettings({ ...settings, defaultDimensionValues: dvals });

  return (
    <dashboardSettingsContext.Provider
      value={{
        ...settings,
        setBaselineRow,
        setDifferenceType,
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
