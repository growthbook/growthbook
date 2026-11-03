import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { startCase } from "lodash";
import type {
  ApiInterleavingInterface,
  InterleavingAnalysis,
} from "shared/validators";
import { ago, getValidDate } from "shared/dates";
import { interleavingVariationsList } from "shared/util";
import { ExperimentMetricDefinition, isFactMetric } from "shared/experiments";
import { useInterleavingResults } from "@/hooks/useInterleavings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import {
  INTERLEAVING_ANALYSIS_TITLES,
  interleavingResultToSnapshotMetrics,
} from "@/services/interleaving";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import ResultsTable from "@/components/Experiment/ResultsTable";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import Metadata from "@/ui/Metadata";
import AnalysisSettingInfo from "@/components/AnalysisSettingInfo";
import Link from "@/ui/Link";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import StatusErrorCallout from "@/components/ContextualBandit/StatusErrorCallout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const SECTIONS: {
  type: InterleavingAnalysis["type"];
  description: string;
}[] = [
  {
    type: "paired",
    description:
      "Per engaged impression: the metric credited to each ranker's items, compared within the same ranked list.",
  },
  {
    type: "preference",
    description:
      "Per exposed user: each user is credited to the ranker whose items they engaged with more.",
  },
];

const numberFormatter = Intl.NumberFormat();

export default function InterleavingResults({
  interleaving: il,
  editAnalysis,
}: {
  interleaving: ApiInterleavingInterface;
  editAnalysis?: () => void;
}) {
  const { getExperimentMetricById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
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
  const datasource = getDatasourceById(il.datasourceId);
  const canRefresh =
    !!datasource && permissionsUtil.canRunExperimentQueries(datasource);

  if (loading) return <LoadingOverlay />;
  const variations = (
    snapshot ? interleavingVariationsList(snapshot.settings.variations) : []
  ).map((v, index) => ({
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
      const displayMetric: ExperimentMetricDefinition =
        type === "preference" &&
        isFactMetric(metric) &&
        metric.metricType !== "funnel"
          ? { ...metric, metricType: "proportion" as const }
          : metric;
      return [
        {
          label: metric.name,
          metric: displayMetric,
          metricOverrideFields: [],
          resultGroup: "goal",
          variations: interleavingResultToSnapshotMetrics(r),
        },
      ];
    });

  // Snapshots written before `usersExposed` existed still carry the same number
  // on any preference result, which is where it used to be the only copy.
  const usersExposed =
    snapshot?.usersExposed ??
    snapshot?.results?.find((r) => r.analysis.type === "preference")?.users;

  // "user_id" -> "User Ids", matching the experiment results toolbar
  const unitDisplayName = snapshot?.settings.userIdType
    ? startCase(snapshot.settings.userIdType.split("_").join(" ")) + "s"
    : "Units";

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
      <Flex direction="row" align="start" gap="3" mx="1" mb="4">
        {editAnalysis ? (
          <Link type="button" onClick={editAnalysis} mr="2">
            Edit Settings
          </Link>
        ) : null}
        {snapshot && (
          <>
            {/* Interleaving has no engine choice; the label says which test
                family the p-values come from. */}
            <Metadata label="Engine" value="Frequentist" />
          </>
        )}
      </Flex>
      <Frame px="0" py="0" style={{ overflow: "hidden" }}>
        <Box px="3" pt="3" pb="1">
          <Flex align="center" justify="end" gapX="6" gapY="2" wrap="wrap">
            <Flex align="center" gap="4">
              {usersExposed !== undefined && (
                <Metadata
                  label={unitDisplayName}
                  value={numberFormatter.format(usersExposed)}
                  style={{ whiteSpace: "nowrap" }}
                />
              )}
              <QueriesLastRun
                status={queryStatus}
                dateCreated={
                  snapshot ? new Date(snapshot.dateCreated) : undefined
                }
              />
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
        {snapshot &&
          SECTIONS.map(({ type, description }) => {
            const rows = rowsFor(type);
            if (!rows.length) return null;
            return (
              <Box key={type} mb="4">
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
                  labelHeader={
                    <Flex align="center" gap="1">
                      {INTERLEAVING_ANALYSIS_TITLES[type]}
                      <AnalysisSettingInfo
                        ariaLabel={`What ${INTERLEAVING_ANALYSIS_TITLES[type]} analysis measures`}
                        description={description}
                      />
                    </Flex>
                  }
                  renderLabelColumn={renderLabelColumn}
                  statsEngine="frequentist"
                  differenceType="absolute"
                  significanceThresholds={{
                    pValueThreshold: snapshot.settings.pValueThreshold,
                    bayesianConfidenceLevels,
                  }}
                  isTabActive
                  noStickyHeader
                  sampleSizeFrom={
                    type === "preference" ? "denominator" : undefined
                  }
                  // The default 130/75 fades the ranker names mid-word; the
                  // header is the only place they appear with two variations.
                  valueColumnWidth={170}
                  labelMaxWidth={120}
                />
              </Box>
            );
          })}
      </Frame>
    </Box>
  );
}
