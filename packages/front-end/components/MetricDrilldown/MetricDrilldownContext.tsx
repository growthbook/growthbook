import React, { useState, useCallback, useMemo, FC, ReactNode } from "react";
import {
  ExperimentStatus,
  LookbackOverride,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "shared/types/report";
import { ExperimentSnapshotAnalysis } from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { formatDimensionValueForDisplay } from "shared/experiments";
import { ExperimentTableRow } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import MetricDrilldownModal from "./MetricDrilldownModal";
import {
  MetricDrilldownContext,
  MetricDrilldownContextValue,
  DrilldownOptions,
  MetricDrilldownTab,
} from "./useMetricDrilldownContext";

// Re-export for consumers
export { useMetricDrilldownContext } from "./useMetricDrilldownContext";

export interface MetricDrilldownProviderProps {
  children: ReactNode;

  // Required experiment/analysis data
  experimentId: string;
  phase: number;
  experimentStatus?: ExperimentStatus;
  analysis: ExperimentSnapshotAnalysis | null;
  variations: ExperimentReportVariation[];

  // Metric configuration
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  customMetricSlices?: Array<{
    slices: Array<{ column: string; levels: string[] }>;
  }>;

  // Stats configuration
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;

  // Date context
  startDate: string;
  endDate: string;
  reportDate: Date;

  // Optional state
  isLatestPhase?: boolean;
  sequentialTestingEnabled?: boolean;
  lookbackOverride?: LookbackOverride;
  differenceType?: DifferenceType;
  baselineRow?: number;
  variationFilter?: number[];

  // Optional sorting state
  sortBy?: "significance" | "change" | null;
  sortDirection?: "asc" | "desc" | null;

  // SSR polyfills for public pages
  ssrPolyfills?: SSRPolyfills;

  // When true, timeseries is unavailable and a message is shown instead
  isReportContext?: boolean;
}

interface OpenModalInfo {
  metricRow: ExperimentTableRow;
  initialTab?: MetricDrilldownTab;
  initialSliceSearchTerm?: string;
  dimensionInfo?: { name: string; value: string; index: number };
}

export const MetricDrilldownProvider: FC<MetricDrilldownProviderProps> = ({
  children,
  experimentId,
  phase,
  experimentStatus,
  analysis,
  variations,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  settingsForSnapshotMetrics,
  customMetricSlices,
  statsEngine,
  pValueCorrection,
  startDate,
  endDate,
  reportDate,
  isLatestPhase = true,
  sequentialTestingEnabled,
  lookbackOverride,
  differenceType = "relative",
  baselineRow = 0,
  variationFilter,
  sortBy,
  sortDirection,
  ssrPolyfills,
  isReportContext,
}) => {
  const [openModalInfo, setOpenModalInfo] = useState<OpenModalInfo | null>(
    null,
  );

  const openDrilldown = useCallback(
    (row: ExperimentTableRow, options?: DrilldownOptions) => {
      if (!analysis?.results) return;

      // Resolve dimension index if dimensionInfo is provided
      let resolvedDimensionInfo:
        | { name: string; value: string; index: number }
        | undefined;

      if (options?.dimensionInfo) {
        const index = analysis.results.findIndex(
          (r) =>
            formatDimensionValueForDisplay(r.name) ===
            options.dimensionInfo?.value,
        );
        if (index !== -1) {
          resolvedDimensionInfo = { ...options.dimensionInfo, index };
        }
      }

      if (row.isSliceRow) {
        setOpenModalInfo({
          metricRow: row,
          initialTab: options?.initialTab ?? "slices",
          initialSliceSearchTerm:
            options?.initialSliceSearchTerm ??
            (typeof row.label === "string" ? row.label : ""),
          dimensionInfo: resolvedDimensionInfo,
        });
      } else {
        setOpenModalInfo({
          metricRow: row,
          initialTab: options?.initialTab ?? "overview",
          dimensionInfo: resolvedDimensionInfo,
        });
      }
    },
    [analysis?.results],
  );

  const closeModal = useCallback(() => {
    setOpenModalInfo(null);
  }, []);

  const contextValue = useMemo<MetricDrilldownContextValue>(
    () => ({ openDrilldown }),
    [openDrilldown],
  );

  return (
    <MetricDrilldownContext.Provider value={contextValue}>
      {children}
      {openModalInfo !== null && analysis && (
        <MetricDrilldownModal
          row={openModalInfo.metricRow}
          close={closeModal}
          initialTab={openModalInfo.initialTab}
          results={analysis.results[openModalInfo.dimensionInfo?.index ?? 0]}
          goalMetrics={goalMetrics}
          secondaryMetrics={secondaryMetrics}
          guardrailMetrics={guardrailMetrics}
          metricOverrides={metricOverrides}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          customMetricSlices={customMetricSlices}
          statsEngine={statsEngine}
          pValueCorrection={pValueCorrection}
          differenceType={differenceType}
          baselineRow={baselineRow}
          variationFilter={variationFilter}
          experimentId={experimentId}
          phase={phase}
          experimentStatus={experimentStatus}
          variations={variations}
          startDate={startDate}
          endDate={endDate}
          reportDate={reportDate}
          isLatestPhase={isLatestPhase}
          sequentialTestingEnabled={sequentialTestingEnabled}
          initialSortBy={sortBy}
          initialSortDirection={sortDirection}
          initialSliceSearchTerm={openModalInfo.initialSliceSearchTerm}
          dimensionInfo={openModalInfo.dimensionInfo}
          lookbackOverride={lookbackOverride}
          ssrPolyfills={ssrPolyfills}
          isReportContext={isReportContext}
        />
      )}
    </MetricDrilldownContext.Provider>
  );
};
