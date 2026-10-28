import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import type {
  ApiInterleavingInterface,
  InterleavingAnalysis,
} from "shared/validators";
import { ago, getValidDate } from "shared/dates";
import { useInterleavingResults } from "@/hooks/useInterleavings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import { interleavingResultToSnapshotMetrics } from "@/services/interleaving";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import ResultsTable from "@/components/Experiment/ResultsTable";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import StatusErrorCallout from "@/components/ContextualBandit/StatusErrorCallout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
  editAnalysis,
}: {
  interleaving: ApiInterleavingInterface;
  editAnalysis?: () => void;
}) {
  const { getExperimentMetricById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const pValueThreshold = usePValueThreshold(il.project);
  const bayesianConfidenceLevels = useConfidenceLevels(il.project);
  const {
    snapshot,
    latest,
    running,
    loading,
    error,
    statusError,
    mutate,
    refresh,
    refreshing,
    refreshError,
  } = useInterleavingResults(il.id);
  const datasource = getDatasourceById(il.datasource);
  const canRefresh =
    !!datasource && permissionsUtil.canRunExperimentQueries(datasource);

  if (loading) return <LoadingOverlay />;
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

  const { status: queryStatus } = getQueryStatus(
    latest?.queries ?? [],
    latest?.error,
  );

  const justStarted =
    !!il.dateStarted &&
    (Date.now() - getValidDate(il.dateStarted).getTime()) / (1000 * 60) < 120;
  const emptyStateMessage = !snapshot
    ? 'Click the "Update" button above.'
    : justStarted && il.dateStarted
      ? `It was just started ${ago(il.dateStarted)}. Give it a little longer and click the "Update" button above to check again.`
      : "Make sure your Interleaving Experiment is tracking properly.";

  return (
    <Box>
      <Frame px="0" py="0" style={{ overflow: "hidden" }}>
        <Box px="3" pt="3" pb="1">
          <Flex align="center" justify="between" gapX="6" gapY="2" wrap="wrap">
            <Box style={{ flex: "1 0 auto", order: -1 }}>
              <QueriesLastRun
                status={queryStatus}
                dateCreated={
                  snapshot ? new Date(snapshot.dateCreated) : undefined
                }
              />
            </Box>
            <Flex align="center" gap="2">
              <Button
                onClick={refresh}
                loading={refreshing || running}
                disabled={!canRefresh}
                variant="outline"
                icon={<PiArrowClockwise />}
              >
                Update
              </Button>
              <ResultMoreMenu
                datasource={datasource}
                project={il.project}
                hasData={!!snapshot?.results?.length}
                legacyQueries={latest?.queries ?? []}
                legacyQueryError={latest?.error}
                editMetrics={editAnalysis}
                canEditMetrics={!!editAnalysis}
                editMetricsLabel="Edit analysis settings"
                forceRefresh={canRefresh ? refresh : undefined}
                notebookUrl=""
                notebookFilename={il.trackingKey}
                supportsNotebooks={false}
              />
            </Flex>
          </Flex>
        </Box>
        {(error || refreshError) && (
          <Callout status="error" mx="3" mb="3">
            {refreshError || error?.message}
          </Callout>
        )}
        {statusError && (
          <Box mx="3" mb="3">
            <StatusErrorCallout error={statusError} onRetry={() => mutate()} />
          </Box>
        )}
        {latest?.status === "error" && (
          <Callout status="error" mx="3" mb="3">
            {latest.error || "The most recent update failed."}
          </Callout>
        )}
        {!snapshot?.results?.length &&
          !running &&
          latest?.status !== "error" && (
            <Callout status="info" mx="3" mb="3">
              No data yet. {emptyStateMessage}
            </Callout>
          )}
      </Frame>
      {snapshot &&
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
