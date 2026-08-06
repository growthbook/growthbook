// TODO(holdout-v1.5): attach holdout-vs-bandit comparison view and EDF recommendations here.
import { ReactNode, useMemo, useState } from "react";
import { Box, Flex, SegmentedControl } from "@radix-ui/themes";
import { startCase } from "lodash";
import { getValidDate } from "shared/dates";
import { ApiContextualBanditInterface } from "shared/validators";
import {
  expandMetricGroups,
  conditionFromLeafClauses,
} from "shared/experiments";
import type {
  ContextualBanditResultsLeaf,
  ContextualLeafClause,
} from "shared/experiments";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Metadata from "@/ui/Metadata";
import Heading from "@/ui/Heading";
import Heatmap, { HeatmapColumn, HeatmapRow } from "@/ui/Heatmap";
import VariationLabel from "@/ui/VariationLabel";
import VariationNumber from "@/ui/VariationNumber";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useContextualBanditResults } from "@/hooks/useContextualBandits";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";

const numberFormatter = Intl.NumberFormat();

type ComparisonMode = "weights" | "means" | "units";

const EMPTY_SNAPSHOT_NOTICE =
  "Contextual bandit results are not available for this snapshot yet. Run or refresh results to compute weights per context.";
const EXPLORING_NOTICE =
  "This Contextual Bandit is in its exploratory stage. Updating results recomputes stats but does not change variation weights — weights stay evenly split until the exploratory stage ends.";
const EMPTY_SNAPSHOT_EXPLORING_NOTICE =
  "This Contextual Bandit is in its exploratory stage, so weights stay evenly split until the exploratory stage ends. Run or refresh results to compute stats.";

function getResultsNotice(
  hasTableData: boolean,
  isExploring: boolean,
): string | null {
  if (!hasTableData) {
    return isExploring
      ? EMPTY_SNAPSHOT_EXPLORING_NOTICE
      : EMPTY_SNAPSHOT_NOTICE;
  }
  return isExploring ? EXPLORING_NOTICE : null;
}

function shouldShowUpdateMessage(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  return message.trim().toLowerCase() !== "successfully updated";
}

function LeafContextsLabel({ clauses }: { clauses: ContextualLeafClause[] }) {
  const condition = useMemo(
    () => JSON.stringify(conditionFromLeafClauses(clauses)),
    [clauses],
  );

  if (!clauses.length || condition === "{}") {
    return (
      <Text size="md" color="text-low">
        All contexts
      </Text>
    );
  }

  return <ConditionDisplay condition={condition} />;
}

function leafCellValues(
  leaf: ContextualBanditResultsLeaf,
  mode: ComparisonMode,
  numVariations: number,
): (number | null)[] {
  return Array.from({ length: numVariations }, (_, i) => {
    const v = leaf.variations[i];
    if (!v) return null;
    const value =
      mode === "means"
        ? v.mean
        : mode === "units"
          ? v.users
          : (v.weight ?? v.bestArmProbability);
    return value !== undefined && value !== null ? Number(value) : null;
  });
}

function leafTotalSampleSize(leaf: ContextualBanditResultsLeaf): number {
  return leaf.variations.reduce((sum, v) => sum + (v.users ?? 0), 0);
}

function formatWeight(value: number): string {
  if (value > 0 && value < 0.01) return "< 1%";
  const rounded = Math.round(value * 100) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

function formatModeValue(value: number, mode: ComparisonMode): string {
  if (Number.isNaN(value)) return "—";
  if (mode === "weights") return formatWeight(value);
  if (mode === "units") return numberFormatter.format(Math.round(value));
  return new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 3,
  }).format(value);
}

function OverallWeights({
  variations,
  weights,
  units,
  unitDisplayName,
}: {
  variations: ApiContextualBanditInterface["variations"];
  weights: (number | null)[];
  units: number[];
  unitDisplayName: string;
}) {
  const cards = variations
    .map((v, index) => ({
      id: v.id,
      index,
      name: v.name,
      weight: weights[index] ?? null,
      units: units[index] ?? 0,
    }))
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));

  return (
    <Flex
      align="stretch"
      style={{ overflowX: "auto" }}
      role="list"
      aria-label="Overall weights by variation"
    >
      {cards.map((card, i) => (
        <Box
          key={card.id}
          role="listitem"
          px="3"
          py="1"
          style={{
            minWidth: 110,
            flex: "1 1 0",
            borderLeft: i === 0 ? undefined : "1px solid var(--gray-a4)",
          }}
        >
          <VariationLabel number={card.index} name={card.name} />
          <Heading as="h4" size="xl" weight="medium" mt="2">
            {card.weight === null ? "—" : formatWeight(card.weight)}
          </Heading>
          <Text size="sm" color="text-low">
            {numberFormatter.format(card.units)} {unitDisplayName.toLowerCase()}
          </Text>
        </Box>
      ))}
    </Flex>
  );
}

export default function ContextualBanditResultsTable({
  cb,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
}) {
  const [mode, setMode] = useState<ComparisonMode>("weights");
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const { getDatasourceById, metricGroups } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const {
    loading,
    isValidating,
    contextualBanditSnapshot,
    results,
    latest,
    refresh,
    refreshError,
  } = useContextualBanditResults(cb.id);

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;
  const { contextualBanditQueriesMap } = useContextualBanditQueries(
    cb.datasource,
  );
  const userIdType = contextualBanditQueriesMap.get(
    cb.contextualBanditQueryId,
  )?.userIdType;
  const unitDisplayName = userIdType
    ? startCase(userIdType.split("_").join(" ")) + "s"
    : "Units";

  const queryLatest = latest;
  const { status } = getQueryStatus(
    queryLatest?.queries || [],
    queryLatest?.error,
  );

  const allExpandedMetrics = useMemo(() => {
    const ids = cb.decisionMetric ? [cb.decisionMetric] : [];
    return Array.from(new Set(expandMetricGroups(ids, metricGroups)));
  }, [cb.decisionMetric, metricGroups]);

  const canRunQueries =
    !!datasource &&
    permissionsUtil.canRunExperimentQueries(datasource) &&
    allExpandedMetrics.length > 0;

  const variations = cb.variations;
  const numVariations = variations.length;

  const leaves = useMemo(() => results?.leaves ?? [], [results?.leaves]);
  const hasTableData = leaves.length > 0;

  const leavesBySampleSize = useMemo(
    () =>
      [...leaves].sort(
        (a, b) => leafTotalSampleSize(b) - leafTotalSampleSize(a),
      ),
    [leaves],
  );

  const overallVariations = useMemo(
    () => results?.overall.variations ?? [],
    [results?.overall.variations],
  );
  const overallVariationWeights = useMemo(
    () =>
      Array.from(
        { length: numVariations },
        (_, i) => overallVariations[i]?.weight ?? null,
      ),
    [numVariations, overallVariations],
  );
  const overallVariationUnits = useMemo(
    () =>
      Array.from(
        { length: numVariations },
        (_, i) => overallVariations[i]?.users ?? 0,
      ),
    [numVariations, overallVariations],
  );

  const totalUnits = useMemo(
    () => leaves.reduce((sum, leaf) => sum + leafTotalSampleSize(leaf), 0),
    [leaves],
  );

  const showQueries =
    !!queryLatest && (status === "failed" || status === "partially-succeeded");

  const isExploring = cb.stage === "explore";
  const isSnapshotRunning = latest?.status === "running";
  const resultsNotice =
    !hasTableData && (loading || isValidating || isSnapshotRunning)
      ? null
      : getResultsNotice(hasTableData, isExploring);

  const comparisonColumns: HeatmapColumn[] = useMemo(
    () =>
      variations.map((v, index) => ({
        key: v.id,
        header: (
          <Tooltip content={v.name} side="top">
            <VariationNumber number={index} />
          </Tooltip>
        ),
        align: "center",
        cellAlign: "center",
      })),
    [variations],
  );

  const comparisonRows: HeatmapRow[] = useMemo(
    () =>
      leavesBySampleSize.map((leaf) => {
        const messageNode: ReactNode =
          shouldShowUpdateMessage(leaf.updateMessage) || leaf.error ? (
            <>
              {shouldShowUpdateMessage(leaf.updateMessage) ? (
                <Text size="sm" color="text-low" as="div" mt="1">
                  {leaf.updateMessage}
                </Text>
              ) : null}
              {leaf.error ? (
                <HelperText status="error" size="sm" mt="1">
                  {leaf.error}
                </HelperText>
              ) : null}
            </>
          ) : null;

        return {
          key: `leaf-${leaf.leafId}`,
          label: (
            <Box>
              <LeafContextsLabel clauses={leaf.clauses} />
              {messageNode}
            </Box>
          ),
          leading: [
            <Text key="units" size="md" color="text-mid">
              {numberFormatter.format(leafTotalSampleSize(leaf))}
            </Text>,
          ],
          cells: leafCellValues(leaf, mode, numVariations).map((value) => ({
            value,
          })),
        };
      }),
    [leavesBySampleSize, mode, numVariations],
  );

  const headerActions = (
    <Flex align="center" gap="4" wrap="wrap">
      {contextualBanditSnapshot ? (
        <Metadata
          label={unitDisplayName}
          value={numberFormatter.format(totalUnits)}
          style={{ whiteSpace: "nowrap" }}
        />
      ) : null}
      <QueriesLastRun
        status={status}
        dateCreated={queryLatest?.dateCreated}
        latestQueryDate={queryLatest?.dateCreated}
        nextUpdate={
          cb.nextSnapshotAttempt
            ? getValidDate(cb.nextSnapshotAttempt)
            : undefined
        }
        autoUpdateEnabled={cb.status === "running" && !!cb.autoSnapshots}
        showAutoUpdateWidget={true}
        failedString={
          queryLatest && !queryLatest.queries.length && queryLatest.error
            ? `Snapshot update failed: ${queryLatest.error}`
            : undefined
        }
        queries={
          showQueries ? queryLatest.queries.map((q) => q.query) : undefined
        }
        onViewQueries={
          showQueries ? () => setQueriesModalOpen(true) : undefined
        }
      />
      {canRunQueries ? (
        <RunQueriesButton
          cta="Update results"
          icon="refresh"
          model={{
            queries: queryLatest?.queries ?? [],
            runStarted: queryLatest?.runStarted ?? null,
          }}
          cancelEndpoint={`/api/v1/contextual-bandits/${cb.id}/cancel`}
          mutate={mutate}
          onSubmit={async () => {
            await refresh();
            mutate();
          }}
        />
      ) : null}
      <ResultMoreMenu
        datasource={datasource}
        project={cb.project}
        hasData={hasTableData}
        legacyQueries={queryLatest?.queries ?? []}
        legacyQueryError={queryLatest?.error}
        forceRefresh={
          canRunQueries
            ? async () => {
                await refresh();
                mutate();
              }
            : undefined
        }
        notebookUrl=""
        notebookFilename={cb.trackingKey}
        supportsNotebooks={false}
      />
    </Flex>
  );

  return (
    <Box>
      <Flex justify="between" align="center" mb="3" gap="4" wrap="wrap">
        <Heading as="h3" size="sm">
          Overall Weights
        </Heading>
        {headerActions}
      </Flex>

      {resultsNotice ? (
        <Callout status="info" mb="3">
          {resultsNotice}
        </Callout>
      ) : null}

      {refreshError ? (
        <Callout status="error" mb="3">
          {refreshError}
        </Callout>
      ) : null}

      {hasTableData ? (
        <>
          <OverallWeights
            variations={variations}
            weights={overallVariationWeights}
            units={overallVariationUnits}
            unitDisplayName={unitDisplayName}
          />

          <Flex
            justify="between"
            align="center"
            mt="5"
            mb="3"
            gap="3"
            wrap="wrap"
          >
            <Heading as="h3" size="sm">
              Comparison
            </Heading>
            <SegmentedControl.Root
              size="1"
              value={mode}
              onValueChange={(value) => setMode(value as ComparisonMode)}
              aria-label="Comparison value type"
            >
              <SegmentedControl.Item value="weights">
                Weights
              </SegmentedControl.Item>
              <SegmentedControl.Item value="means">Means</SegmentedControl.Item>
              <SegmentedControl.Item value="units">
                {unitDisplayName}
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>

          <Heatmap
            labelHeader="Context"
            leadingColumns={[
              {
                key: "units",
                header: unitDisplayName,
                align: "end",
                width: "14%",
              },
            ]}
            columns={comparisonColumns}
            rows={comparisonRows}
            colorScale="indigo"
            stickyHeader
            formatValue={(value) => formatModeValue(value, mode)}
          />
        </>
      ) : null}

      {queriesModalOpen && showQueries && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={queryLatest.queries.map((q) => q.query)}
          savedQueries={[]}
          error={queryLatest.error}
        />
      )}
    </Box>
  );
}
