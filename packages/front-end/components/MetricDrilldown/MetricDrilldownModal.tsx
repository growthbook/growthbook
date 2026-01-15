import { FC, useState } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getMetricLink } from "shared/experiments";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentStatus } from "shared/types/experiment";
import { ExperimentReportVariation } from "shared/types/report";
import Modal from "@/components/Modal";
import { ExperimentTableRow } from "@/services/experiments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MetricName from "@/components/Metrics/MetricName";
import { useKeydown } from "@/hooks/useKeydown";
import { MetricDrilldownMetadata } from "./MetricDrilldownMetadata";
import styles from "./MetricDrilldownModal.module.scss";
import MetricDrilldownOverview from "./MetricDrilldownOverview";
import MetricDrilldownSlices from "./MetricDrilldownSlices";

export type MetricDrilldownTab = "overview" | "slices" | "debug";

interface MetricDrilldownModalProps {
  row: ExperimentTableRow;
  statsEngine: StatsEngine;
  close: () => void;
  initialTab?: MetricDrilldownTab;
  experimentId: string;
  phase: number;
  experimentStatus: ExperimentStatus;
  differenceType: DifferenceType;
  baselineRow?: number;
  variationFilter?: number[];
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  allRows?: ExperimentTableRow[];
  initialSliceSearchTerm?: string;
}

const MetricDrilldownModal: FC<MetricDrilldownModalProps> = ({
  row,
  statsEngine,
  close,
  initialTab = "overview",
  experimentId,
  phase,
  experimentStatus,
  differenceType,
  baselineRow = 0,
  variationFilter,
  goalMetrics = [],
  secondaryMetrics = [],
  guardrailMetrics = [],
  variations,
  startDate,
  endDate,
  reportDate,
  isLatestPhase,
  pValueCorrection,
  sequentialTestingEnabled,
  allRows = [],
  initialSliceSearchTerm,
}) => {
  const { metric } = row;

  // Create local state for filters that can be modified within the modal
  const [localBaselineRow, setLocalBaselineRow] = useState(baselineRow);
  const [localVariationFilter, setLocalVariationFilter] = useState<
    number[] | undefined
  >(variationFilter);
  const [localDifferenceType, setLocalDifferenceType] =
    useState<DifferenceType>(differenceType);

  // Local state for Slices tab (persists across tab switches)
  const [sliceSearchTerm, setSliceSearchTerm] = useState(
    initialSliceSearchTerm || "",
  );
  const [visibleSliceTimeSeriesRowIds, setVisibleSliceTimeSeriesRowIds] =
    useState<string[]>(() => {
      // Auto-expand first slice timeseries when opened from a slice click
      // Only if initialTab is "slices" and we have an initial search term
      if (initialTab === "slices" && initialSliceSearchTerm) {
        // Compute the row ID based on the expected structure
        const tableId = `${experimentId}_${metric.id}_slices`;
        // We'll need to find the matching row from allRows
        const matchingRow = allRows.find(
          (r) =>
            r.isSliceRow &&
            r.metric.id === metric.id &&
            r.sliceId &&
            typeof r.label === "string" &&
            r.label
              .toLowerCase()
              .includes(initialSliceSearchTerm.toLowerCase()),
        );
        if (matchingRow?.sliceId) {
          return [`${tableId}-${matchingRow.metric.id}-${matchingRow.sliceId}`];
        }
      }
      return [];
    });

  useKeydown("Escape", close);

  return (
    <Tabs defaultValue={initialTab}>
      <Modal
        open={true}
        borderlessHeader={true}
        backgroundlessHeader={true}
        headerClassName={styles.metricDrilldownModalHeader}
        bodyClassName={styles.metricDrilldownModalBody}
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
              {/* TODO: Check how it renders with long / markdown descriptions */}
              {metric.description}
            </Text>

            <Flex gap="5" mt="2">
              <Link
                href={getMetricLink(metric.id)}
                target="_blank"
                weight="bold"
              >
                View details <PiArrowSquareOut />
              </Link>

              <MetricDrilldownMetadata statsEngine={statsEngine} row={row} />
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
          <MetricDrilldownOverview
            row={row}
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
            guardrailMetrics={guardrailMetrics}
            statsEngine={statsEngine}
            pValueCorrection={pValueCorrection}
            localDifferenceType={localDifferenceType}
            setLocalDifferenceType={setLocalDifferenceType}
            sequentialTestingEnabled={sequentialTestingEnabled}
          />
        </TabsContent>
        <TabsContent value="slices">
          <MetricDrilldownSlices
            metric={metric}
            allRows={allRows}
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
            searchTerm={sliceSearchTerm}
            setSearchTerm={setSliceSearchTerm}
            visibleTimeSeriesRowIds={visibleSliceTimeSeriesRowIds}
            setVisibleTimeSeriesRowIds={setVisibleSliceTimeSeriesRowIds}
          />
        </TabsContent>
        <TabsContent value="debug">Debug</TabsContent>
      </Modal>
    </Tabs>
  );
};

export default MetricDrilldownModal;
