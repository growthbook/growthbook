import React, { FC, ReactNode, useMemo } from "react";
import { DefinitionsContext } from "@/services/DefinitionsContext";
import { getFactTables, getFactMetrics, getDatasource } from "./db";

export const MockDefinitionsProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  // We can't easily access the real context here to spread it,
  // but we can provide a minimal implementation that satisfies the parts we need.
  // In a real app, we might want to merge with existing context.

  const value = useMemo(() => {
    const factTables = getFactTables();
    const factMetrics = getFactMetrics();
    const datasources = [getDatasource()];

    const getFactTableById = (id: string) =>
      factTables.find((t) => t.id === id) || null;
    const getFactMetricById = (id: string) =>
      factMetrics.find((m) => m.id === id) || null;
    const getDatasourceById = (id: string) =>
      datasources.find((d) => d.id === id) || null;
    const getMetricById = () => null;
    const getDimensionById = () => null;
    const getSegmentById = () => null;
    const getProjectById = () => null;
    const getSavedGroupById = () => null;
    const getTagById = () => null;
    const getExperimentMetricById = () => null;
    const getMetricGroupById = () => null;
    const getDecisionCriteriaById = () => null;

    // Cast to any because we're not implementing the full interface,
    // just what's needed for the explorer to render
    return {
      ready: true,
      factTables,
      factMetrics,
      datasources,
      getFactTableById,
      getFactMetricById,
      getDatasourceById,
      getMetricById,
      getDimensionById,
      getSegmentById,
      getProjectById,
      getSavedGroupById,
      getTagById,
      getExperimentMetricById,
      getMetricGroupById,
      getDecisionCriteriaById,
      // Add other required fields with empty/default values
      metrics: [],
      dimensions: [],
      segments: [],
      projects: [],
      tags: [],
      savedGroups: [],
      metricGroups: [],
      customFields: [],
      decisionCriteria: [],
    } as any;
  }, []);

  return (
    <DefinitionsContext.Provider value={value}>
      {children}
    </DefinitionsContext.Provider>
  );
};
