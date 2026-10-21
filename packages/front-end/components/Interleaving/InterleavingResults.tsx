import { Box, Flex } from "@radix-ui/themes";
import type {
  ApiInterleavingInterface,
  InterleavingAnalysis,
} from "shared/validators";
import { datetime } from "shared/dates";
import { useInterleavingResults } from "@/hooks/useInterleavings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import { interleavingResultToSnapshotMetrics } from "@/services/interleaving";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

const SECTIONS: {
  type: InterleavingAnalysis["type"];
  title: string;
  description: string;
}[] = [
  {
    type: "paired",
    title: "Paired",
    description:
      "Per engaged impression: the metric credited to each ranker's items, compared within the same ranked list.",
  },
  {
    type: "preference",
    title: "Preference",
    description:
      "Per exposed user: each user is credited to the ranker whose items they engaged with more.",
  },
];

export default function InterleavingResults({
  interleaving: il,
}: {
  interleaving: ApiInterleavingInterface;
}) {
  const { getExperimentMetricById } = useDefinitions();
  const pValueThreshold = usePValueThreshold(il.project);
  const bayesianConfidenceLevels = useConfidenceLevels(il.project);
  const { snapshot, loading, error, refresh, refreshing, refreshError } =
    useInterleavingResults(il.id);

  if (loading) return <LoadingOverlay />;

  const running = snapshot?.status === "running";
  const variations = il.variations.map((v, index) => ({
    id: v.id,
    name: v.name || v.key,
    weight: 0.5,
    index,
  }));
  const renderLabelColumn = getRenderLabelColumn({});

  const rowsFor = (type: InterleavingAnalysis["type"]) =>
    (snapshot?.results ?? []).flatMap((r): ExperimentTableRow[] => {
      const metric = getExperimentMetricById(r.metricId);
      if (r.analysis.type !== type || !metric) return [];
      return [
        {
          label: metric.name,
          metric,
          metricOverrideFields: [],
          resultGroup: "goal",
          variations: interleavingResultToSnapshotMetrics(r),
        },
      ];
    });

  return (
    <Box>
      <Flex align="center" justify="between" mb="3">
        <Text color="text-mid">
          {snapshot
            ? `Last updated ${datetime(snapshot.dateCreated)}`
            : "No results yet."}
        </Text>
        <Button onClick={refresh} loading={refreshing || running}>
          {running ? "Running..." : "Update Results"}
        </Button>
      </Flex>
      {(error || refreshError) && (
        <Callout status="error" mb="3">
          {refreshError || error?.message}
        </Callout>
      )}
      {snapshot?.status === "error" && (
        <Callout status="error" mb="3">
          {snapshot.error || "The last analysis failed."}
        </Callout>
      )}
      {snapshot?.status === "success" &&
        SECTIONS.map(({ type, title, description }) => {
          const rows = rowsFor(type);
          if (!rows.length) return null;
          return (
            <Box key={type} mb="5">
              <Heading as="h3" size="md" mb="1">
                {title}
              </Heading>
              <Text as="p" color="text-mid" mb="3">
                {description}
              </Text>
              <ResultsTable
                id={`interleaving-${il.id}-${type}`}
                experimentId={il.id}
                rows={rows}
                variations={variations}
                baselineRow={0}
                status={il.status}
                isLatestPhase
                phase={0}
                startDate={snapshot.settings.startDate}
                endDate={snapshot.settings.endDate ?? ""}
                dateCreated={new Date(snapshot.dateCreated)}
                tableRowAxis="metric"
                labelHeader="Metric"
                renderLabelColumn={renderLabelColumn}
                statsEngine="frequentist"
                differenceType="absolute"
                significanceThresholds={{
                  pValueThreshold,
                  bayesianConfidenceLevels,
                }}
                isTabActive
                noStickyHeader
              />
            </Box>
          );
        })}
    </Box>
  );
}
