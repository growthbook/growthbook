import { FC, useEffect, useMemo, useState } from "react";
import { MdSwapCalls } from "react-icons/md";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Link, Text, Tooltip } from "@radix-ui/themes";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus, MetricOverride } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
} from "shared/types/experiment-snapshot";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import Modal from "@/components/Modal";
import {
  ExperimentTableRow,
  applyMetricOverrides,
} from "@/services/experiments";
import { getPercentileLabel } from "@/services/metrics";
import {
  capitalizeFirstLetter,
  isNullUndefinedOrEmpty,
} from "@/services/utils";
import Metadata from "@/ui/Metadata";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import FactMetricTypeDisplayName from "../Metrics/FactMetricTypeDisplayName";
import MetricName from "../Metrics/MetricName";
import SortedTags from "../Tags/SortedTags";
import ExperimentMetricTimeSeriesGraphWrapper from "./ExperimentMetricTimeSeriesGraphWrapper";
import ResultsTable from "./ResultsTable";
import SlicesSection from "./SlicesSection";
import SupplementalResultsSection from "./SupplementalResultsSection";
import styles from "./MetricDetailsModal.module.scss";

interface MetricDetailsModalProps {
  metric: ExperimentMetricInterface;
  row: ExperimentTableRow;
  statsEngine?: StatsEngine;
  open: boolean;
  close: () => void;
  experimentId: string;
  phase: number;
  experimentStatus: ExperimentStatus;
  differenceType: DifferenceType;
  variationNames: string[];
  showVariations: boolean[];
  pValueAdjustmentEnabled: boolean;
  firstDateToRender: Date;
  sliceId?: string;
  allRows?: ExperimentTableRow[];
  baselineRow: number;
  variationFilter?: number[];
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  hideDetails?: boolean;
  metricOverrides?: MetricOverride[];
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  initialTab?: "overview" | "slices" | "debug";
  initialSliceSearchTerm?: string;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
}

const MetricDetailsModal: FC<MetricDetailsModalProps> = ({
  metric,
  row,
  statsEngine,
  close,
  experimentId,
  phase,
  experimentStatus,
  differenceType,
  variationNames,
  showVariations: _showVariations,
  pValueAdjustmentEnabled,
  firstDateToRender,
  sliceId,
  allRows = [],
  baselineRow = 0,
  variationFilter = [],
  goalMetrics = [],
  secondaryMetrics = [],
  hideDetails = false,
  metricOverrides = [],
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  pValueCorrection,
  sequentialTestingEnabled,
  initialTab = "overview",
  initialSliceSearchTerm = "",
  snapshot,
  analysis,
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Create local state for filters that can be modified within the modal
  const [localBaselineRow, setLocalBaselineRow] = useState(baselineRow);
  const [localVariationFilter, setLocalVariationFilter] =
    useState<number[]>(variationFilter);
  const [localDifferenceType, setLocalDifferenceType] =
    useState<DifferenceType>(differenceType);

  // Reset to initial tab when modal reopens or initialTab changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Reset local filters when parent filters change (modal reopens)
  useEffect(() => {
    setLocalBaselineRow(baselineRow);
    setLocalVariationFilter(variationFilter);
    setLocalDifferenceType(differenceType);
  }, [baselineRow, variationFilter, differenceType]);

  // Calculate which fields are overridden
  const metricOverrideFields = useMemo(() => {
    const { overrideFields } = applyMetricOverrides(metric, metricOverrides);
    return overrideFields;
  }, [metric, metricOverrides]);

  // Calculate local showVariations based on local variation filter
  const localShowVariations = useMemo(() => {
    if (!localVariationFilter || localVariationFilter.length === 0) {
      return variations.map(() => true);
    }
    return variations.map((_, i) => !localVariationFilter.includes(i));
  }, [localVariationFilter, variations]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [close]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <Modal
        open={true}
        headerClassName={styles.modalHeader}
        bodyClassName={styles.modalBody}
        borderlessHeader={true}
        backgroundlessHeader={true}
        header={
          <Text size="6" weight="bold">
            <MetricName
              id={metric.id}
              showOfficialLabel
              disableTooltip
              officialBadgePosition="right"
            />
          </Text>
        }
        subHeader={
          <Box mt="3">
            <Text size="2" style={{ color: "var(--color-text-mid)" }}>
              {metric.description}
            </Text>

            <Flex gap="5" mt="2">
              <Link
                href={`/metrics/${metric.id}`}
                target="_blank"
                weight="bold"
              >
                View details
                <PiArrowSquareOut className="ml-1" />
              </Link>

              <Flex gap="4">
                <Metadata
                  label="Type"
                  value={
                    <Flex gap="1" align="center">
                      {isFactMetric(metric) ? (
                        <FactMetricTypeDisplayName type={metric.metricType} />
                      ) : (
                        metric.type
                      )}
                      {metric.inverse ? (
                        <Tooltip content="Metric is inverse, lower is better">
                          <span>
                            <MdSwapCalls />
                          </span>
                        </Tooltip>
                      ) : null}
                    </Flex>
                  }
                />

                {!hideDetails && (metric.tags?.length ?? 0) > 0 ? (
                  <Metadata
                    label="Tags"
                    value={
                      <SortedTags
                        tags={metric.tags}
                        shouldShowEllipsis={false}
                        useFlex={true}
                      />
                    }
                  />
                ) : null}

                {quantileMetricType(metric) !== "" ? (
                  <>
                    <Metadata
                      label="Quantile"
                      value={
                        isFactMetric(metric) && metric.quantileSettings
                          ? getPercentileLabel(metric.quantileSettings.quantile)
                          : null
                      }
                    />
                    <Metadata
                      label="Quantile Type"
                      value={
                        isFactMetric(metric) && metric.quantileSettings
                          ? `${
                              metric.quantileSettings.type === "unit"
                                ? "Per-user"
                                : "Events"
                            }${
                              metric.quantileSettings.ignoreZeros
                                ? " (ignoring zeros)"
                                : ""
                            }`
                          : null
                      }
                    />
                  </>
                ) : null}

                {!isNullUndefinedOrEmpty(metric.cappingSettings.type) &&
                (metric.cappingSettings.value ?? 0) !== 0 ? (
                  <Metadata
                    label={`Capping (${metric.cappingSettings.type})`}
                    value={metric.cappingSettings.value}
                  />
                ) : null}

                {(!isNullUndefinedOrEmpty(metric.windowSettings.type) ||
                  metricOverrideFields.includes("windowType")) &&
                (metric.windowSettings.windowValue !== 0 ||
                  metricOverrideFields.includes("windowHours")) ? (
                  <Metadata
                    label={`${capitalizeFirstLetter(
                      metric.windowSettings.type || "no",
                    )} Window`}
                    value={
                      <>
                        {metric.windowSettings.type
                          ? `${metric.windowSettings.windowValue} ${metric.windowSettings.windowUnit}`
                          : ""}
                        {metricOverrideFields.includes("windowType") ||
                        metricOverrideFields.includes("windowHours") ? (
                          <small className="text-purple ml-1">(override)</small>
                        ) : null}
                      </>
                    }
                  />
                ) : null}

                {(metric.windowSettings.delayValue ?? 0) !== 0 ||
                metricOverrideFields.includes("delayHours") ? (
                  <Metadata
                    label={
                      isFactMetric(metric) && metric.metricType === "retention"
                        ? "Retention Window"
                        : "Metric Delay"
                    }
                    value={
                      <>
                        {`${metric.windowSettings.delayValue} ${metric.windowSettings.delayUnit}`}
                        {metricOverrideFields.includes("delayHours") ? (
                          <small className="text-purple ml-1">(override)</small>
                        ) : null}
                      </>
                    }
                  />
                ) : null}

                {statsEngine === "bayesian" ? (
                  <Metadata
                    label="Bayesian Prior"
                    value={
                      <>
                        {row.metricSnapshotSettings?.properPrior
                          ? `Mean: ${
                              row.metricSnapshotSettings?.properPriorMean ?? 0
                            }, Std. Dev.: ${
                              row.metricSnapshotSettings?.properPriorStdDev ??
                              DEFAULT_PROPER_PRIOR_STDDEV
                            }`
                          : "Disabled"}
                        {metricOverrideFields.includes("prior") ? (
                          <small className="text-purple ml-1">(override)</small>
                        ) : null}
                      </>
                    }
                  />
                ) : null}

                {row.metricSnapshotSettings ? (
                  <Metadata
                    label="CUPED"
                    value={
                      <>
                        {row.metricSnapshotSettings?.regressionAdjustmentEnabled
                          ? "Enabled"
                          : "Disabled"}
                        {metricOverrideFields.includes(
                          "regressionAdjustmentEnabled",
                        ) ? (
                          <small className="text-purple ml-1">(override)</small>
                        ) : null}
                      </>
                    }
                  />
                ) : null}

                {row.metricSnapshotSettings?.regressionAdjustmentEnabled ? (
                  <Metadata
                    label="CUPED Lookback (days)"
                    value={
                      <>
                        {row.metricSnapshotSettings?.regressionAdjustmentDays}
                        {metricOverrideFields.includes(
                          "regressionAdjustmentDays",
                        ) ? (
                          <small className="text-purple ml-1">(override)</small>
                        ) : null}
                      </>
                    }
                  />
                ) : null}
              </Flex>
            </Flex>

            <TabsList mt="5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="slices">Slices</TabsTrigger>
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
        <TabsContent value="overview">
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={experimentStatus}
            variations={variations}
            baselineRow={localBaselineRow}
            setBaselineRow={setLocalBaselineRow}
            variationFilter={localVariationFilter}
            setVariationFilter={setLocalVariationFilter}
            rows={[row]}
            id={`${experimentId}_${metric.id}_modal`}
            resultGroup={
              goalMetrics.includes(metric.id)
                ? "goal"
                : secondaryMetrics.includes(metric.id)
                  ? "secondary"
                  : "guardrail"
            }
            tableRowAxis="metric"
            labelHeader=""
            renderLabelColumn={({ label }) => label}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueCorrection={pValueCorrection}
            differenceType={localDifferenceType}
            setDifferenceType={setLocalDifferenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
            isTabActive={activeTab === "overview"}
            noStickyHeader={true}
            noTooltip={false}
            isBandit={false}
            isHoldout={false}
            skipLabelRow
          />
          <ExperimentMetricTimeSeriesGraphWrapper
            experimentId={experimentId}
            phase={phase}
            experimentStatus={experimentStatus}
            metric={metric}
            differenceType={localDifferenceType}
            variationNames={variationNames}
            showVariations={localShowVariations}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            pValueAdjustmentEnabled={pValueAdjustmentEnabled}
            firstDateToRender={firstDateToRender}
            sliceId={sliceId}
          />
        </TabsContent>

        <TabsContent value="slices">
          <SlicesSection
            metric={metric}
            allRows={allRows}
            variationNames={variationNames}
            differenceType={localDifferenceType}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            baselineRow={localBaselineRow}
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
            initialSearchTerm={initialSliceSearchTerm}
          />
        </TabsContent>

        <TabsContent value="debug">
          <SupplementalResultsSection
            row={row}
            metric={metric}
            statsEngine={statsEngine || DEFAULT_STATS_ENGINE}
            differenceType={localDifferenceType}
            variationNames={variationNames}
            baselineRow={localBaselineRow}
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
            snapshot={snapshot}
            analysis={analysis}
          />
        </TabsContent>
      </Modal>
    </Tabs>
  );
};

export default MetricDetailsModal;
