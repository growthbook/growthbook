import { useCallback, useMemo } from "react";
import { DEFAULT_P_VALUE_THRESHOLD } from "shared/constants";
import { ExperimentReportSSRData } from "shared/types/report";
import { ExperimentMetricInterface } from "shared/experiments";
import { CommercialFeature } from "shared/enterprise";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { FactTableInterface } from "shared/types/fact-table";
import { DimensionInterface } from "shared/types/dimension";
import { ProjectInterface } from "shared/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useCurrency } from "@/hooks/useCurrency";
import { supportedCurrencies } from "@/services/settings";
import {
  useOrganizationMetricDefaults,
  METRIC_DEFAULTS,
} from "@/hooks/useOrganizationMetricDefaults";

export interface SSRPolyfills {
  getExperimentMetricById: (id: string) => null | ExperimentMetricInterface;
  metricGroups: MetricGroupInterface[];
  getMetricGroupById: (id: string) => null | MetricGroupInterface;
  getFactTableById: (id: string) => null | FactTableInterface;
  useOrgSettings: typeof useOrgSettings;
  getProjectById: (id: string) => null | ProjectInterface;
  useCurrency: typeof useCurrency;
  usePValueThreshold: typeof usePValueThreshold;
  useConfidenceLevels: typeof useConfidenceLevels;
  useOrganizationMetricDefaults: typeof useOrganizationMetricDefaults;
  dimensions: DimensionInterface[];
  getDimensionById: (id: string) => null | DimensionInterface;
  hasCommercialFeature: (feature: CommercialFeature) => boolean;
}

export default function useSSRPolyfills(
  ssrData: ExperimentReportSSRData | null,
): SSRPolyfills {
  const {
    getExperimentMetricById,
    getMetricGroupById,
    getFactTableById,
    metricGroups,
    dimensions,
    getDimensionById,
    getProjectById,
  } = useDefinitions();

  const hasCsrSettings = !!Object.keys(useOrgSettings() || {})?.length;

  const getExperimentMetricByIdSSR = useCallback(
    (metricId: string) =>
      getExperimentMetricById(metricId) || ssrData?.metrics?.[metricId] || null,
    [getExperimentMetricById, ssrData?.metrics],
  );
  const metricGroupsSSR = useMemo(
    () => [...metricGroups, ...(ssrData?.metricGroups ?? [])],
    [metricGroups, ssrData?.metricGroups],
  );
  const getMetricGroupByIdSSR = useCallback(
    (metricGroupId: string) =>
      getMetricGroupById(metricGroupId) ||
      metricGroupsSSR?.[metricGroupId] ||
      null,
    [getMetricGroupById, metricGroupsSSR],
  );
  const getFactTableByIdSSR = useCallback(
    (id: string) => getFactTableById(id) || ssrData?.factTables?.[id] || null,
    [getFactTableById, ssrData?.factTables],
  );

  const useOrgSettingsSSR = () => {
    const orgSettings = useOrgSettings();
    return hasCsrSettings ? orgSettings : ssrData?.settings || {};
  };
  const getProjectByIdSSR = useCallback(
    (id: string) => getProjectById(id) || ssrData?.projects?.[id] || null,
    [getProjectById, ssrData?.projects],
  );
  const useCurrencySSR = () => {
    const currency = useCurrency();
    if (hasCsrSettings) return currency;
    return (ssrData?.settings?.displayCurrency ?? "") in supportedCurrencies
      ? (ssrData?.settings?.displayCurrency ?? "USD")
      : "USD";
  };
  const usePValueThresholdSSR = () => {
    const pValueThreshold = usePValueThreshold();
    return hasCsrSettings
      ? pValueThreshold
      : ssrData?.settings?.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD;
  };
  const useConfidenceLevelsSSR = () => {
    const confidenceLevels = useConfidenceLevels();
    if (hasCsrSettings) return confidenceLevels;
    const ciUpper = ssrData?.settings?.confidenceLevel || 0.95;
    return {
      ciUpper,
      ciLower: 1 - ciUpper,
      ciUpperDisplay: Math.round(ciUpper * 100) + "%",
      ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
    };
  };
  const useOrganizationMetricDefaultsSSR = () => {
    const organizationMetricDefaults = useOrganizationMetricDefaults();
    if (hasCsrSettings) return organizationMetricDefaults;
    return {
      ...organizationMetricDefaults,
      metricDefaults: {
        ...METRIC_DEFAULTS,
        ...(ssrData?.settings?.metricDefaults || {}),
      },
    };
  };

  const dimensionsSSR = useMemo(
    () => [...dimensions, ...(ssrData?.dimensions ?? [])],
    [dimensions, ssrData?.dimensions],
  );
  const getDimensionByIdSSR = useCallback(
    (id: string) => getDimensionById(id) || dimensionsSSR?.[id] || null,
    [getDimensionById, dimensionsSSR],
  );

  const ssrCommercialFeatures = useMemo(
    () => new Set(ssrData?.commercialFeatures ?? []),
    [ssrData?.commercialFeatures],
  );
  const hasCommercialFeatureSSR = useCallback(
    (feature: CommercialFeature) => ssrCommercialFeatures.has(feature),
    [ssrCommercialFeatures],
  );

  return {
    getExperimentMetricById: getExperimentMetricByIdSSR,
    metricGroups: metricGroupsSSR,
    getMetricGroupById: getMetricGroupByIdSSR,
    getFactTableById: getFactTableByIdSSR,
    useOrgSettings: useOrgSettingsSSR,
    getProjectById: getProjectByIdSSR,
    useCurrency: useCurrencySSR,
    usePValueThreshold: usePValueThresholdSSR,
    useConfidenceLevels: useConfidenceLevelsSSR,
    useOrganizationMetricDefaults: useOrganizationMetricDefaultsSSR,
    dimensions: dimensionsSSR,
    getDimensionById: getDimensionByIdSSR,
    hasCommercialFeature: hasCommercialFeatureSSR,
  };
}
