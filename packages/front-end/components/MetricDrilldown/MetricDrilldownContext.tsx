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
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentTableRow } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import MetricDrilldownModal from "./MetricDrilldownModal";
import {
  MetricDrilldownContext,
  MetricDrilldownContextValue,
  DrilldownOptions,
  MetricDrilldownTab,
  DrilldownDimensionInfo,
} from "./useMetricDrilldownContext";

// Re-export for consumers
export { useMetricDrilldownContext } from "./useMetricDrilldownContext";

export interface MetricDrilldownProviderProps {
  children: ReactNode;

  // Required experiment/analysis data
  experimentId: string;
  significanceThresholds: SignificanceThresholds;
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

  // Snapshot for report context (no parent SnapshotProvider).
  // When provided, a LocalSnapshotProvider is created in the modal so it can
  // refresh when baseline/difference settings change.
  snapshot?: ExperimentSnapshotInterface;
}

interface OpenModalInfo {
  metricRow: ExperimentTableRow;
  initialResults: ExperimentSnapshotAnalysis["results"][number];
  initialTab?: MetricDrilldownTab;
  initialSliceSearchTerm?: string;
  dimensionInfo?: DrilldownDimensionInfo;
}

export const MetricDrilldownProvider: FC<MetricDrilldownProviderProps> = ({
  children,
  experimentId,
  significanceThresholds,
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
  snapshot,
}) => {
  const [openModalInfo, setOpenModalInfo] = useState<OpenModalInfo | null>(
    null,
  );

  const openDrilldown = useCallback(
    (row: ExperimentTableRow, options?: DrilldownOptions) => {
      if (!analysis?.results?.length) return;

      let initialResults:
        | ExperimentSnapshotAnalysis["results"][number]
        | undefined;
      let resolvedDimensionInfo: DrilldownDimensionInfo | undefined;

      if (options?.dimensionInfo) {
        const dimensionInfo = options.dimensionInfo;
        initialResults = analysis.results.find(
          (r) => r.name === dimensionInfo.rawValue,
        );
        if (!initialResults) {
          console.warn("Metric drilldown dimension value not found", {
            dimensionId: dimensionInfo.id,
            dimensionValue: dimensionInfo.rawValue,
          });
          return;
        }
        resolvedDimensionInfo = dimensionInfo;
      } else {
        initialResults = analysis.results[0];
      }

      if (!initialResults) {
        return;
      }

      if (row.isSliceRow) {
        setOpenModalInfo({
          metricRow: row,
          initialResults,
          initialTab: options?.initialTab ?? "slices",
          initialSliceSearchTerm:
            options?.initialSliceSearchTerm ??
            (typeof row.label === "string" ? row.label : ""),
          dimensionInfo: resolvedDimensionInfo,
        });
      } else {
        setOpenModalInfo({
          metricRow: row,
          initialResults,
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
          results={openModalInfo.initialResults}
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
          significanceThresholds={significanceThresholds}
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
          snapshot={snapshot}
        />
      )}
    </MetricDrilldownContext.Provider>
  );
};
