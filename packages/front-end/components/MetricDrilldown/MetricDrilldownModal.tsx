import { FC, useState, useEffect } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getMetricLink } from "shared/experiments";
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
import Modal from "@/components/Modal";
import { ExperimentTableRow } from "@/services/experiments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MetricName from "@/components/Metrics/MetricName";
import { useKeydown } from "@/hooks/useKeydown";
import { MetricDrilldownMetadata } from "./MetricDrilldownMetadata";
import styles from "./MetricDrilldownModal.module.scss";
import MetricDrilldownOverview from "./MetricDrilldownOverview";

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
  initialShowVariations: boolean[];
  pValueAdjustmentEnabled: boolean;
  firstDateToRender: Date;
  sliceId?: string;
  allRows?: ExperimentTableRow[];
  baselineRow?: number;
  variationFilter?: number[];
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  metricOverrides?: MetricOverride[];
  variations: ExperimentReportVariation[];
  startDate: string;
  endDate: string;
  reportDate: Date;
  isLatestPhase: boolean;
  pValueCorrection?: PValueCorrection;
  sequentialTestingEnabled?: boolean;
  initialSliceSearchTerm?: string;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
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
  initialShowVariations,
  pValueAdjustmentEnabled,
  firstDateToRender,
  sliceId,
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
}) => {
  const { metric } = row;

  // Create local state for filters that can be modified within the modal
  const [localBaselineRow, setLocalBaselineRow] = useState(baselineRow);
  const [localVariationFilter, setLocalVariationFilter] = useState<
    number[] | undefined
  >(variationFilter);
  const [localDifferenceType, setLocalDifferenceType] =
    useState<DifferenceType>(differenceType);

  // Reset local filters when parent filters change (modal reopens)
  useEffect(() => {
    setLocalBaselineRow(baselineRow);
    setLocalVariationFilter(variationFilter);
    setLocalDifferenceType(differenceType);
  }, [baselineRow, variationFilter, differenceType]);

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
        <TabsContent value="slices">Slices</TabsContent>
        <TabsContent value="debug">Debug</TabsContent>
      </Modal>
    </Tabs>
  );
};

export default MetricDrilldownModal;
