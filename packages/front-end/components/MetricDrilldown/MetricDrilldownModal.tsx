import { FC } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getMetricLink } from "shared/experiments";
import { StatsEngine } from "shared/types/stats";
import Modal from "@/components/Modal";
import { ExperimentTableRow } from "@/services/experiments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import MetricName from "@/components/Metrics/MetricName";
import { useKeydown } from "@/hooks/useKeydown";
import { MetricDrilldownMetadata } from "./MetricDrilldownMetadata";
import styles from "./MetricDrilldownModal.module.scss";

export type MetricDrilldownTab = "overview" | "slices" | "debug";

interface MetricDrilldownModalProps {
  row: ExperimentTableRow;
  statsEngine: StatsEngine;
  close: () => void;
  initialTab?: MetricDrilldownTab;
  // experimentId: string;
  // phase: number;
  // experimentStatus: ExperimentStatus;
  // differenceType: DifferenceType;
  // variationNames: string[];
  // showVariations: boolean[];
  // pValueAdjustmentEnabled: boolean;
  // firstDateToRender: Date;
  // sliceId?: string;
  // allRows?: ExperimentTableRow[];
  // baselineRow: number;
  // variationFilter?: number[];
  // goalMetrics?: string[];
  // secondaryMetrics?: string[];
  // guardrailMetrics?: string[];
  // metricOverrides?: MetricOverride[];
  // variations: ExperimentReportVariation[];
  // startDate: string;
  // endDate: string;
  // reportDate: Date;
  // isLatestPhase: boolean;
  // pValueCorrection?: PValueCorrection;
  // sequentialTestingEnabled?: boolean;
  // initialSliceSearchTerm?: string;
  // snapshot?: ExperimentSnapshotInterface;
  // analysis?: ExperimentSnapshotAnalysis;
}

const MetricDrilldownModal: FC<MetricDrilldownModalProps> = ({
  row,
  statsEngine,
  close,
  initialTab = "overview",
}) => {
  const { metric } = row;

  // const [activeTab, setActiveTab] = useState<MetricDrilldownTab>(initialTab);

  // // Create local state for filters that can be modified within the modal
  // const [localBaselineRow, setLocalBaselineRow] = useState(baselineRow);
  // const [localVariationFilter, setLocalVariationFilter] =
  //   useState<number[]>(variationFilter);
  // const [localDifferenceType, setLocalDifferenceType] =
  //   useState<DifferenceType>(differenceType);

  // // Reset to initial tab when modal reopens or initialTab changes
  // useEffect(() => {
  //   setActiveTab(initialTab);
  // }, [initialTab]);

  // // Reset local filters when parent filters change (modal reopens)
  // useEffect(() => {
  //   setLocalBaselineRow(baselineRow);
  //   setLocalVariationFilter(variationFilter);
  //   setLocalDifferenceType(differenceType);
  // }, [baselineRow, variationFilter, differenceType]);

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
        <TabsContent value="overview">Overview</TabsContent>
        <TabsContent value="slices">Slices</TabsContent>
        <TabsContent value="debug">Debug</TabsContent>
      </Modal>
    </Tabs>
  );
};

export default MetricDrilldownModal;
