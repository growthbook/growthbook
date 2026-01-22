import { FC, useState, useMemo, useEffect } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  getMetricLink,
  ExperimentMetricInterface,
  ExperimentSortBy,
} from "shared/experiments";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus, MetricOverride } from "shared/types/experiment";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "shared/types/report";
import Modal from "@/components/Modal";
import { ExperimentTableRow } from "@/services/experiments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MetricName from "@/components/Metrics/MetricName";
import { useKeydown } from "@/hooks/useKeydown";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import {
  useSnapshot,
  LocalSnapshotProvider,
} from "@/components/Experiment/SnapshotProvider";
import { MetricDrilldownOwnerTags } from "./MetricDrilldownOwnerTags";
import styles from "./MetricDrilldownModal.module.scss";
import MetricDrilldownOverview from "./MetricDrilldownOverview";
import MetricDrilldownSlices from "./MetricDrilldownSlices";
import MetricDrilldownDebug from "./MetricDrilldownDebug";

export type MetricDrilldownTab = "overview" | "slices" | "debug";

interface MetricDrilldownModalProps {
  // The clicked metric row - used to identify which metric to display
  row: ExperimentTableRow;
  close: () => void;
  initialTab?: MetricDrilldownTab;

  // useExperimentTableRows parameters (initial values, managed internally)
  results: ExperimentReportResultDimension;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  ssrPolyfills?: SSRPolyfills;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;

  // Initial filter values (modal manages its own state starting from these)
  differenceType: DifferenceType;
  baselineRow?: number;
  variationFilter?: number[];

  // Experiment context props
  experimentId: string;
  phase: number;
  experimentStatus: ExperimentStatus;
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  sequentialTestingEnabled?: boolean;

  // Initial sorting state (inherited from CompactResults)
  initialSortBy?: ExperimentSortBy;
  initialSortDirection?: "asc" | "desc" | null;

  // Slice-specific props
  initialSliceSearchTerm?: string;
}

/**
 * Inner content component that's rendered inside LocalSnapshotProvider.
 * This allows it to use useSnapshot() to get the local context's analysis
 * and compute rows that update when the local context changes.
 */
interface MetricDrilldownContentProps {
  row: ExperimentTableRow;
  metric: ExperimentMetricInterface;
  initialResults: ExperimentReportResultDimension;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  ssrPolyfills?: SSRPolyfills;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  localBaselineRow: number;
  setLocalBaselineRow: (row: number) => void;
  localVariationFilter?: number[];
  setLocalVariationFilter: (filter: number[] | undefined) => void;
  localDifferenceType: DifferenceType;
  setLocalDifferenceType: (type: DifferenceType) => void;
  experimentId: string;
  phase: number;
  experimentStatus: ExperimentStatus;
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  sequentialTestingEnabled?: boolean;
  localSortBy: ExperimentSortBy;
  localSortDirection: "asc" | "desc" | null;
  initialSliceSearchTerm?: string;
  initialTab?: MetricDrilldownTab;
}

const MetricDrilldownContent: FC<MetricDrilldownContentProps> = ({
  row,
  metric,
  initialResults,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  settingsForSnapshotMetrics,
  customMetricSlices,
  ssrPolyfills,
  statsEngine,
  pValueCorrection,
  localBaselineRow,
  setLocalBaselineRow,
  localVariationFilter,
  setLocalVariationFilter,
  localDifferenceType,
  setLocalDifferenceType,
  experimentId,
  phase,
  experimentStatus,
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  sequentialTestingEnabled,
  localSortBy,
  localSortDirection,
  initialSliceSearchTerm,
  initialTab,
}) => {
  const { analysis, snapshot, setAnalysisSettings, mutateSnapshot } =
    useSnapshot();

  // TODO: Check if it is safe to use first results
  const results = analysis?.results?.[0] ?? initialResults;

  // TODO: Check what we need here
  const [expandedMetrics] = useState<Record<string, boolean>>(() => {
    const initialExpanded: Record<string, boolean> = {};
    ["goal", "secondary", "guardrail"].forEach((resultGroup) => {
      initialExpanded[`${metric.id}:${resultGroup}`] = true;
    });
    return initialExpanded;
  });

  const { rows: allRows } = useExperimentTableRows({
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    ssrPolyfills,
    customMetricSlices,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    expandedMetrics,
  });

  const mainMetricRow = useMemo(() => {
    if (!row.isSliceRow) {
      return row;
    }

    return allRows.find((r) => r.metric.id === metric.id) ?? row;
  }, [allRows, metric.id, row]);

  const [sliceSearchTerm, setSliceSearchTerm] = useState(
    initialSliceSearchTerm || "",
  );
  const [visibleSliceTimeSeriesRowIds, setVisibleSliceTimeSeriesRowIds] =
    useState<string[]>(() => {
      if (initialTab === "slices" && initialSliceSearchTerm) {
        const tableId = `${experimentId}_${metric.id}_slices`;
        return [`${tableId}-pending`];
      }
      return [];
    });

  // TODO: Check if this is needed
  useEffect(() => {
    if (
      initialTab === "slices" &&
      initialSliceSearchTerm &&
      visibleSliceTimeSeriesRowIds.length === 1 &&
      visibleSliceTimeSeriesRowIds[0].endsWith("-pending")
    ) {
      const tableId = `${experimentId}_${metric.id}_slices`;
      const matchingRow = allRows.find(
        (r) =>
          r.isSliceRow &&
          r.metric.id === metric.id &&
          r.sliceId &&
          typeof r.label === "string" &&
          r.label.toLowerCase().includes(initialSliceSearchTerm.toLowerCase()),
      );
      if (matchingRow?.sliceId) {
        setVisibleSliceTimeSeriesRowIds([
          `${tableId}-${matchingRow.metric.id}-${matchingRow.sliceId}`,
        ]);
      } else {
        setVisibleSliceTimeSeriesRowIds([]);
      }
    }
  }, [
    allRows,
    experimentId,
    initialSliceSearchTerm,
    initialTab,
    metric.id,
    visibleSliceTimeSeriesRowIds,
  ]);

  return (
    <>
      <TabsContent value="overview">
        <MetricDrilldownOverview
          row={mainMetricRow}
          experimentId={experimentId}
          reportDate={reportDate}
          isLatestPhase={isLatestPhase}
          phase={phase}
          startDate={startDate}
          endDate={endDate}
          experimentStatus={experimentStatus}
          variations={variations}
          localBaselineRow={localBaselineRow}
          setLocalBaselineRow={setLocalBaselineRow}
          localVariationFilter={localVariationFilter}
          setLocalVariationFilter={setLocalVariationFilter}
          goalMetrics={goalMetrics}
          secondaryMetrics={secondaryMetrics}
          statsEngine={statsEngine}
          pValueCorrection={pValueCorrection}
          localDifferenceType={localDifferenceType}
          setLocalDifferenceType={setLocalDifferenceType}
          sequentialTestingEnabled={sequentialTestingEnabled}
          snapshot={snapshot}
          analysis={analysis}
          setAnalysisSettings={setAnalysisSettings}
          mutateSnapshot={mutateSnapshot}
        />
      </TabsContent>
      <TabsContent value="slices">
        <MetricDrilldownSlices
          metric={metric}
          rows={allRows}
          variationNames={variations.map((v) => v.name)}
          differenceType={localDifferenceType}
          setDifferenceType={setLocalDifferenceType}
          statsEngine={statsEngine}
          baselineRow={localBaselineRow}
          setBaselineRow={setLocalBaselineRow}
          variationFilter={localVariationFilter}
          setVariationFilter={setLocalVariationFilter}
          experimentId={experimentId}
          phase={phase}
          variations={variations}
          startDate={startDate}
          endDate={endDate}
          reportDate={reportDate}
          isLatestPhase={isLatestPhase}
          pValueCorrection={pValueCorrection}
          sequentialTestingEnabled={sequentialTestingEnabled}
          experimentStatus={experimentStatus}
          initialSortBy={localSortBy}
          initialSortDirection={localSortDirection}
          searchTerm={sliceSearchTerm}
          setSearchTerm={setSliceSearchTerm}
          visibleTimeSeriesRowIds={visibleSliceTimeSeriesRowIds}
          setVisibleTimeSeriesRowIds={setVisibleSliceTimeSeriesRowIds}
        />
      </TabsContent>
      <TabsContent value="debug">
        <MetricDrilldownDebug
          row={mainMetricRow}
          metric={metric}
          statsEngine={statsEngine}
          differenceType={localDifferenceType}
          setDifferenceType={setLocalDifferenceType}
          baselineRow={localBaselineRow}
          setBaselineRow={setLocalBaselineRow}
          variationFilter={localVariationFilter}
          setVariationFilter={setLocalVariationFilter}
          experimentId={experimentId}
          phase={phase}
          variations={variations}
          startDate={startDate}
          endDate={endDate}
          reportDate={reportDate}
          isLatestPhase={isLatestPhase}
          pValueCorrection={pValueCorrection}
          sequentialTestingEnabled={sequentialTestingEnabled}
          experimentStatus={experimentStatus}
          variationNames={variations.map((v) => v.name)}
        />
      </TabsContent>
    </>
  );
};

const MetricDrilldownModal = ({
  row,
  close,
  initialTab = "overview",
  // useExperimentTableRows parameters
  results,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricOverrides,
  settingsForSnapshotMetrics,
  customMetricSlices,
  ssrPolyfills,
  statsEngine,
  pValueCorrection,
  // Initial filter values
  differenceType,
  baselineRow = 0,
  variationFilter,
  // Experiment context
  experimentId,
  phase,
  experimentStatus,
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  sequentialTestingEnabled,
  // Initial sorting state
  initialSortBy,
  initialSortDirection,
  // Slice-specific
  initialSliceSearchTerm,
}: MetricDrilldownModalProps) => {
  useKeydown("Escape", close);
  useBodyScrollLock(true);
  const { metric } = row;

  // Get snapshot from global snapshot context, to initialize LocalSnapshotProvider
  const {
    snapshot: parentSnapshot,
    experiment,
    phase: contextPhase,
    dimension,
    analysisSettings: parentAnalysisSettings,
  } = useSnapshot();

  // Filters are initialized with parent values but then managed locally
  const [localBaselineRow, setLocalBaselineRow] = useState(baselineRow);
  const [localVariationFilter, setLocalVariationFilter] = useState<
    number[] | undefined
  >(variationFilter);
  const [localDifferenceType, setLocalDifferenceType] =
    useState<DifferenceType>(differenceType);
  const localSortBy = initialSortBy ?? null;
  const localSortDirection = initialSortDirection ?? null;

  const contentProps: MetricDrilldownContentProps = {
    row,
    metric,
    initialResults: results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    settingsForSnapshotMetrics,
    customMetricSlices,
    ssrPolyfills,
    statsEngine,
    pValueCorrection,
    localBaselineRow,
    setLocalBaselineRow,
    localVariationFilter,
    setLocalVariationFilter,
    localDifferenceType,
    setLocalDifferenceType,
    experimentId,
    phase,
    experimentStatus,
    variations,
    startDate,
    endDate,
    reportDate,
    isLatestPhase,
    sequentialTestingEnabled,
    localSortBy,
    localSortDirection,
    initialSliceSearchTerm,
    initialTab,
  };

  return (
    <Tabs defaultValue={initialTab}>
      <Modal
        open={true}
        borderlessHeader={true}
        backgroundlessHeader={true}
        headerClassName={styles.metricDrilldownModalHeader}
        bodyClassName={styles.metricDrilldownModalBody}
        onBackdropClick={close}
        header={
          <Flex align="center" gap="0">
            <Text size="6" weight="bold">
              <MetricName id={metric.id} officialBadgePosition="right" />
            </Text>
            <Link
              href={getMetricLink(metric.id)}
              target="_blank"
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              <PiArrowSquareOut size={16} />
            </Link>
          </Flex>
        }
        subHeader={
          <Box mt="3">
            {metric.description ? (
              <Text
                size="2"
                style={{
                  color: "var(--color-text-mid)",
                  display: "block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {metric.description}
              </Text>
            ) : null}

            <Flex gap="5" mt="2">
              <MetricDrilldownOwnerTags row={row} />
            </Flex>

            <TabsList mt="5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="slices">
                <Flex align="center" gap="1">
                  Slices
                  <PaidFeatureBadge
                    commercialFeature="metric-slices"
                    useTip={false}
                  />
                </Flex>
              </TabsTrigger>
              <TabsTrigger value="debug">Debug</TabsTrigger>
            </TabsList>
          </Box>
        }
        size="max"
        trackingEventModalType="metric-details"
        trackingEventModalSource="results-table"
        cta="Close"
        submit={close}
        autoFocusSelector=""
      >
        {parentSnapshot && experiment ? (
          <LocalSnapshotProvider
            experiment={experiment}
            snapshot={parentSnapshot}
            phase={contextPhase}
            dimension={dimension}
            initialAnalysisSettings={parentAnalysisSettings}
          >
            <MetricDrilldownContent {...contentProps} />
          </LocalSnapshotProvider>
        ) : (
          <MetricDrilldownContent {...contentProps} />
        )}
      </Modal>
    </Tabs>
  );
};

export default MetricDrilldownModal;
